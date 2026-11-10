<?php
// 受付フォームのバックエンド。PHP 7.4+ と curl 拡張が必要。
// 設定は .env(公開フォルダの一つ上、なければ同じフォルダ)から読む。.env.example を参照。
declare(strict_types=1);

const CHUNK_SIZE = 4 * 1024 * 1024; // Google のレジューム送信は 256KB の倍数が必要
const JSON_LIMIT = 65536;
const TOKEN_TTL = 6 * 3600;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 1ファイルの上限。Apps Script が中身を検査できる大きさ(50MB)に合わせる
const FILE_SIGNATURES = ['pdf' => '%PDF-', 'jww' => 'JwwData.']; // ファイル先頭の決まった文字列
const HEATING_TYPES = ['放熱器', 'AC', 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ']; // 案件基本情報 K 列のプルダウンと同じ表記

header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

/** @return never */
function respond(array $data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP);
  exit;
}

function load_env(): array {
  $paths = getenv('KAITO_ENV_FILE') ? [getenv('KAITO_ENV_FILE')] : [dirname(__DIR__) . '/.env', __DIR__ . '/.env'];
  foreach ($paths as $path) {
    if (!is_readable($path)) continue;
    $env = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
      $line = trim($line);
      if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
      [$key, $value] = array_map('trim', explode('=', $line, 2));
      $env[$key] = trim($value, "\"'");
    }
    return $env;
  }
  return [];
}

function http(string $method, string $url, array $headers = [], ?string $body = null, bool $follow = true, int $timeout = 60): array {
  $responseHeaders = [];
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => $follow,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP, // file:// などを使わせない
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_TIMEOUT => $timeout,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$responseHeaders) {
      $parts = explode(':', $line, 2);
      if (count($parts) === 2) $responseHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
      return strlen($line);
    },
  ]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
  $result = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  if ($result === false) throw new RuntimeException('HTTP request failed');
  return [$status, $result, $responseHeaders];
}

function b64(string $bytes): string { return base64_encode($bytes); }

// ブラウザに渡すトークン。中身(Google の送信先 URL など)は暗号化して、ブラウザからは読めないようにする。
// 読めると、ブラウザが api.php を通さずに Google へ直接送り、ファイル形式のチェックを飛ばせてしまう。
function capability_key(string $secret): string { return hash('sha256', 'kaito-form capability|' . $secret, true); }

function capability(array $value, string $secret): string {
  $iv = random_bytes(12);
  $tag = '';
  $plain = json_encode($value + ['expires' => time() + TOKEN_TTL], JSON_UNESCAPED_UNICODE);
  $cipher = openssl_encrypt($plain, 'aes-256-gcm', capability_key($secret), OPENSSL_RAW_DATA, $iv, $tag);
  if ($cipher === false) throw new RuntimeException('Could not encrypt token');
  $payload = b64($iv . $tag . $cipher);
  return $payload . '.' . b64(hash_hmac('sha256', $payload, $secret, true));
}

function read_capability($token, string $kind, string $secret): ?array {
  if (!is_string($token) || strlen($token) > JSON_LIMIT ||
      !preg_match('~^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]{43}=$~D', $token)) return null;
  [$payload, $signature] = explode('.', $token);
  if (!hash_equals(b64(hash_hmac('sha256', $payload, $secret, true)), $signature)) return null;
  $raw = (string) base64_decode($payload, true);
  if (strlen($raw) < 29) return null;
  $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', capability_key($secret), OPENSSL_RAW_DATA,
    substr($raw, 0, 12), substr($raw, 12, 16));
  $value = $plain === false ? null : json_decode($plain, true);
  return is_array($value) && ($value['kind'] ?? '') === $kind && ($value['expires'] ?? 0) >= time() ? $value : null;
}

function read_json(): array {
  $raw = file_get_contents('php://input', false, null, 0, JSON_LIMIT + 1);
  if ($raw === false || strlen($raw) > JSON_LIMIT) respond(['error' => '送信データが大きすぎます。'], 413);
  $data = json_decode($raw, true);
  if (!is_array($data)) respond(['error' => '入力内容をご確認ください。'], 400);
  return $data;
}

function script_request(array $env, array $data, int $timeout = 60): array {
  [$status, $body] = http('POST', $env['APPS_SCRIPT_URL'], ['Content-Type: text/plain;charset=UTF-8'],
    json_encode($data + ['secret' => $env['SHARED_SECRET']], JSON_UNESCAPED_UNICODE), true, $timeout);
  $result = json_decode($body, true);
  if ($status !== 200 || !is_array($result) || empty($result['ok'])) throw new RuntimeException('Apps Script failed');
  return $result;
}

function verify_turnstile(array $env, $token): bool {
  [$status, $body] = http('POST', 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    ['Content-Type: application/x-www-form-urlencoded'],
    http_build_query(['secret' => $env['TURNSTILE_SECRET'], 'response' => is_string($token) ? $token : '',
      'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '']));
  $result = json_decode($body, true);
  return $status === 200 && is_array($result) && !empty($result['success']);
}

function text_field(array $data, string $name, int $max): ?string {
  $value = isset($data[$name]) && is_string($data[$name]) ? trim($data[$name]) : '';
  return mb_strlen($value) > $max ? null : $value;
}

function validate_fields(array $data): ?array {
  $limits = ['company' => 100, 'branch' => 100, 'contact' => 100, 'email' => 254, 'projectName' => 200,
    'projectAddress' => 200, 'heating' => 20, 'start' => 10, 'note' => 1000];
  $fields = [];
  foreach ($limits as $name => $max) {
    $value = text_field($data, $name, $max);
    if ($value === null) return null;
    $fields[$name] = $value;
  }
  $date = function (string $v): bool { return $v === '' || (bool) preg_match('/^\d{4}-\d{2}-\d{2}$/D', $v); };
  if ($fields['company'] === '' || $fields['contact'] === '' || $fields['projectName'] === '' ||
      $fields['projectAddress'] === '' || !filter_var($fields['email'], FILTER_VALIDATE_EMAIL) ||
      preg_match('/[^\x21-\x7e]/', $fields['email']) || // 半角・全角スペースや全角文字を含むメールアドレスは受け付けない
      ($fields['heating'] !== '' && !in_array($fields['heating'], HEATING_TYPES, true)) ||
      !$date($fields['start'])) return null;
  return $fields;
}

function prepare(array $env): void {
  $data = read_json();
  $fields = validate_fields($data);
  if ($fields === null) respond(['error' => '入力内容をご確認ください。'], 400);
  $files = $data['files'] ?? null;
  $valid = is_array($files) && $files && count($files) <= 20;
  $pdf = $jww = 0;
  $tooLarge = false;
  foreach ($valid ? $files : [] as $file) {
    $name = is_array($file) && is_string($file['name'] ?? null) ? $file['name'] : '';
    $size = is_array($file) ? ($file['size'] ?? 0) : 0;
    if (mb_strlen($name) > 200 || !preg_match('/\.(pdf|jww)$/iD', $name) || preg_match('/[\x00-\x1f\x7f]/', $name) || !is_int($size) || $size <= 0) { $valid = false; break; }
    if ($size > MAX_FILE_SIZE) $tooLarge = true;
    preg_match('/\.pdf$/iD', $name) ? $pdf++ : $jww++;
  }
  if (!$valid || $pdf > 10 || $jww > 10) respond(['error' => 'PDFとJWWは、それぞれ10ファイルまで添付できます。'], 400);
  if ($tooLarge) respond(['error' => 'ファイルは1つあたり50MBまでです。'], 400);
  if (!verify_turnstile($env, $data['token'] ?? '')) respond(['error' => '「私はロボットではありません」を確認してから送信してください。'], 403);

  $files = array_map(function ($f) { return ['name' => $f['name'], 'size' => $f['size']]; }, $files);
  $prepared = script_request($env, ['action' => 'prepare', 'company' => $fields['company'], 'files' => $files]);
  $uploads = array_map(function ($u) use ($env) {
    return capability(['kind' => 'upload', 'url' => $u['url'], 'size' => $u['size'], 'type' => $u['type'], 'name' => $u['name']],
      $env['SHARED_SECRET']);
  }, $prepared['uploads']);
  $receipt = capability(['kind' => 'receipt', 'fields' => $fields, 'folderId' => $prepared['folderId'],
    'files' => array_map(function ($u) { return ['id' => $u['id'], 'size' => $u['size'], 'name' => $u['name']]; }, $prepared['uploads'])],
    $env['SHARED_SECRET']);
  respond(['uploads' => $uploads, 'receipt' => $receipt, 'chunkSize' => CHUNK_SIZE]);
}

function relay_chunk(array $env): void {
  $upload = read_capability($_SERVER['HTTP_X_UPLOAD_KEY'] ?? '', 'upload', $env['SHARED_SECRET']);
  if (!$upload) respond(['error' => 'アップロードの有効期限が切れました。'], 403);
  $url = $upload['url'];
  if (strpos($url, 'https://www.googleapis.com/upload/drive/v3/files') !== 0) throw new RuntimeException('Invalid upload destination');
  $size = $upload['size'];
  $range = $_SERVER['HTTP_X_CONTENT_RANGE'] ?? '';
  $probe = $range === 'bytes */' . $size;
  $start = $end = 0;
  if (!$probe) {
    if (!preg_match('/^bytes (\d+)-(\d+)\/(\d+)$/D', $range, $m)) respond(['error' => 'ファイルの送信範囲が正しくありません。'], 400);
    [$start, $end, $total] = [(int) $m[1], (int) $m[2], (int) $m[3]];
    $length = $end - $start + 1;
    if ($total !== $size || $end >= $size || $length <= 0 || $length > CHUNK_SIZE ||
        ($end + 1 < $size && $length % (256 * 1024))) respond(['error' => 'ファイルの送信範囲が正しくありません。'], 400);
  }
  $body = $probe ? '' : file_get_contents('php://input', false, null, 0, CHUNK_SIZE + 1);
  if (!$probe && strlen((string) $body) !== $length) respond(['error' => 'ファイルの送信範囲が正しくありません。'], 400);
  if (!$probe && $start === 0) {
    // 拡張子だけ .pdf / .jww に変えた別の形式のファイル(実行ファイルなど)を、最初の部分で止める
    $ext = strtolower(pathinfo((string) ($upload['name'] ?? ''), PATHINFO_EXTENSION));
    $signature = FILE_SIGNATURES[$ext] ?? null;
    if ($signature === null || strncmp((string) $body, $signature, strlen($signature)) !== 0) {
      respond(['error' => $ext === 'jww' ? 'JWWファイルの形式をご確認ください。' : 'PDFの形式をご確認ください。'], 400);
    }
  }
  [$status, , $headers] = http('PUT', $url, ['Content-Range: ' . $range, 'Content-Length: ' . strlen((string) $body),
    'Content-Type: ' . $upload['type']], (string) $body, false);
  if ($status === 308) {
    $offset = preg_match('/^bytes=0-(\d+)$/D', $headers['range'] ?? '', $r) ? (int) $r[1] + 1 : 0;
    respond(['offset' => $offset]);
  }
  if ($status >= 200 && $status < 300) respond(['offset' => $size]);
  respond(['error' => 'ファイルを保存できませんでした。'], $status >= 500 ? 502 : 409);
}

function finish(array $env): void {
  $receipt = read_capability(read_json()['receipt'] ?? '', 'receipt', $env['SHARED_SECRET']);
  if (!$receipt) respond(['error' => '受付の有効期限が切れました。'], 403);
  // Apps Script が PDF の中身を検査するので、記録の完了まで数分かかることがある
  @set_time_limit(330);
  script_request($env, ['action' => 'finish', 'folderId' => $receipt['folderId'], 'files' => $receipt['files']] + $receipt['fields'], 300);
  respond(['ok' => true]);
}

$env = load_env();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET' && $action === 'config') respond(['siteKey' => $env['TURNSTILE_SITE_KEY'] ?? '']);
if ($method !== 'POST' || !in_array($action, ['prepare', 'upload', 'finish'], true)) respond(['error' => 'Not found'], 404);
foreach (['APPS_SCRIPT_URL', 'SHARED_SECRET', 'TURNSTILE_SECRET', 'TURNSTILE_SITE_KEY'] as $key) {
  if (empty($env[$key])) respond(['error' => '現在、受付の準備中です。担当者にお問い合わせください。'], 503);
}
$maxLength = $action === 'upload' ? CHUNK_SIZE : JSON_LIMIT;
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > $maxLength) respond(['error' => '送信データが大きすぎます。'], 413);

try {
  if ($action === 'prepare') prepare($env);
  if ($action === 'upload') relay_chunk($env);
  finish($env);
} catch (Throwable $e) {
  error_log('kaito-form: ' . $e->getMessage());
  respond(['error' => '受付処理を完了できませんでした。担当者にご確認ください。'], 502);
}
