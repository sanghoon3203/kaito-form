<?php
// 受付フォームの処理。ブラウザ側の JavaScript は使わない(通常の HTML フォームを PHP が受け取る)。
// PHP 7.4+ と curl・mbstring・openssl 拡張が必要。設定は .env(public の一つ上)から読む。.env.example を参照。
declare(strict_types=1);

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 1ファイルの上限。Apps Script が中身を検査できる大きさ(50MB)
const MAX_FILES_PER_TYPE = 10;
const FILE_SIGNATURES = ['pdf' => '%PDF-', 'jww' => 'JwwData.']; // ファイル先頭の決まった文字列
const HEATING_TYPES = ['放熱器', 'AC', 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ']; // 案件基本情報「床下暖房種別」のプルダウンと同じ表記
const FORM_TOKEN_TTL = 2 * 3600;
const DRIVE_UPLOAD_PREFIX = 'https://www.googleapis.com/upload/drive/v3/files';

function env(): array {
  static $env = null;
  if ($env !== null) return $env;
  $env = [];
  $paths = getenv('KAITO_ENV_FILE') ? [getenv('KAITO_ENV_FILE')] : [dirname(__DIR__) . '/.env'];
  foreach ($paths as $path) {
    if (!is_readable($path)) continue;
    foreach ((array) file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
      $line = trim((string) $line);
      if ($line === '' || $line[0] === '#' || strpos($line, '=') === false) continue;
      [$key, $value] = array_map('trim', explode('=', $line, 2));
      $env[$key] = trim($value, "\"'");
    }
    break;
  }
  return $env;
}

function env_int(string $key, int $default): int {
  $value = env()[$key] ?? '';
  return is_numeric($value) ? (int) $value : $default;
}

function h($value): string { return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }

function send_security_headers(): void {
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: no-referrer');
  header('X-Frame-Options: DENY');
  // JavaScript を一切読み込まない。フォントだけ Google Fonts から読む
  header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; " .
    "font-src https://fonts.gstatic.com; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}

// ---- 保存用のフォルダ(送信回数の記録・使用済みトークン) ----

function data_dir(): string {
  $dir = env()['DATA_DIR'] ?? (dirname(__DIR__) . '/data');
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  return $dir;
}

// ---- フォームのトークン(ボット対策と二重送信防止) ----

function sign(string $payload): string { return hash_hmac('sha256', $payload, env()['SHARED_SECRET'] ?? '', false); }

function issue_form_token(): string {
  $payload = time() . '.' . bin2hex(random_bytes(12));
  return $payload . '.' . sign($payload);
}

/** @return string|null エラーメッセージ。問題なければ null */
function check_form_token($token): ?string {
  if (!is_string($token) || !preg_match('/^(\d{10})\.([0-9a-f]{24})\.([0-9a-f]{64})$/D', $token, $m) ||
      !hash_equals(sign($m[1] . '.' . $m[2]), $m[3])) return '画面の有効期限が切れました。もう一度ご入力ください。';
  $age = time() - (int) $m[1];
  if ($age > FORM_TOKEN_TTL) return '画面の有効期限が切れました。もう一度ご入力ください。';
  if ($age < env_int('MIN_FORM_SECONDS', 3)) return '送信が早すぎます。内容をご確認のうえ、もう一度送信してください。';
  // 一度使ったトークンは使えない(送信ボタンの二度押しや、同じ内容の再送信を防ぐ)。'x' は既にあれば失敗する
  $fp = @fopen(data_dir() . '/used-' . $m[2], 'x');
  if ($fp === false) {
    if (!is_writable(data_dir())) throw new RuntimeException('Cannot write data dir');
    return 'このフォームは送信済みです。重複を避けるため、もう一度送る前に担当者へご確認ください。';
  }
  fclose($fp);
  return null;
}

function token_used($token): bool {
  return is_string($token) && preg_match('/^\d{10}\.([0-9a-f]{24})\./', $token, $m) && is_file(data_dir() . '/used-' . $m[1]);
}

/**
 * 直近1時間の合計に $amount を足しても $limit 以内なら、記録して true を返す。
 * ponytail: キーごとにファイル1つで管理。受付が多くなったら DB へ
 */
function within_hourly_limit(string $key, int $limit, int $amount = 1): bool {
  $fp = fopen(data_dir() . '/rate-' . hash('sha256', $key) . '.json', 'c+');
  if (!$fp) throw new RuntimeException('Cannot write data dir');
  flock($fp, LOCK_EX);
  $entries = array_values(array_filter((array) json_decode((string) stream_get_contents($fp), true), function ($e) {
    return is_array($e) && is_int($e[0] ?? null) && is_int($e[1] ?? null) && $e[0] > time() - 3600;
  }));
  $ok = array_sum(array_column($entries, 1)) + $amount <= $limit;
  if ($ok) $entries[] = [time(), $amount];
  ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode($entries));
  flock($fp, LOCK_UN); fclose($fp);
  return $ok;
}

/** 送信元の単位。IPv6 は利用者が /64 の中でいくらでもアドレスを変えられるので、/64 でまとめる */
function client_key(string $ip): string {
  $packed = @inet_pton($ip);
  if ($packed !== false && strlen($packed) === 16 && substr($packed, 0, 12) !== str_repeat("\0", 10) . "\xff\xff") {
    return 'ip6:' . bin2hex(substr($packed, 0, 8));
  }
  return 'ip:' . ($packed !== false && strlen($packed) === 16 ? inet_ntop(substr($packed, 12)) : $ip);
}

// ---- 入力のチェック ----

function ini_bytes(string $key): int {
  $value = trim((string) ini_get($key));
  $number = (int) $value;
  switch (strtolower(substr($value, -1))) {
    case 'g': return $number * 1024 ** 3;
    case 'm': return $number * 1024 ** 2;
    case 'k': return $number * 1024;
  }
  return $number;
}

function max_file_size(): int { return min(MAX_FILE_SIZE, ini_bytes('upload_max_filesize') ?: MAX_FILE_SIZE); }
function max_total_size(): int { return ini_bytes('post_max_size') ?: PHP_INT_MAX; }

function format_mb(int $bytes): string { return rtrim(rtrim(number_format($bytes / 1024 / 1024, 1), '0'), '.') . 'MB'; }

/** @return array{0: array, 1: string[]} 整えた入力値とエラーメッセージ */
function validate_fields(array $post): array {
  $limits = ['company' => 100, 'branch' => 100, 'contact' => 100, 'email' => 254, 'projectName' => 200,
    'projectAddress' => 200, 'heating' => 20, 'start' => 10, 'note' => 1000];
  $fields = [];
  $errors = [];
  foreach ($limits as $name => $max) {
    $value = isset($post[$name]) && is_string($post[$name]) ? trim(str_replace("\r\n", "\n", $post[$name])) : '';
    if (mb_strlen($value) > $max) { $errors[] = '入力が長すぎる項目があります。'; $value = mb_substr($value, 0, $max); }
    $fields[$name] = $value;
  }
  $required = ['company' => '会社名', 'contact' => 'ご担当者名', 'email' => 'メールアドレス', 'projectName' => '案件名',
    'projectAddress' => '案件住所'];
  foreach ($required as $name => $label) {
    if ($fields[$name] === '') $errors[] = $label . 'をご入力ください。';
  }
  if ($fields['email'] !== '' && (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL) ||
      preg_match('/[^\x21-\x7e]/', $fields['email']))) { // 半角・全角スペースや全角文字を含むものは受け付けない
    $errors[] = 'メールアドレスは半角英数字でご入力ください。';
  }
  if ($fields['heating'] !== '' && !in_array($fields['heating'], HEATING_TYPES, true)) $errors[] = '床下暖房種別をご確認ください。';
  if ($fields['start'] !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $fields['start'])) $errors[] = '着工予定日をご確認ください。';
  return [$fields, array_values(array_unique($errors))];
}

/** $_FILES['drawing'] を確かめる。@return array{0: array, 1: string[]} */
function validate_files($upload): array {
  $files = [];
  $errors = [];
  if (!is_array($upload) || !is_array($upload['name'] ?? null)) return [[], ['図面ファイルを添付してください。']];
  $count = ['pdf' => 0, 'jww' => 0];
  foreach ($upload['name'] as $i => $name) {
    $error = $upload['error'][$i] ?? UPLOAD_ERR_NO_FILE;
    if ($error === UPLOAD_ERR_NO_FILE) continue;
    if ($error === UPLOAD_ERR_INI_SIZE || $error === UPLOAD_ERR_FORM_SIZE) { $errors[] = 'ファイルは1つあたり' . format_mb(max_file_size()) . 'までです。'; continue; }
    if ($error !== UPLOAD_ERR_OK) { $errors[] = 'ファイルを受け取れませんでした。もう一度お試しください。'; continue; }
    $name = (string) $name;
    $tmp = (string) $upload['tmp_name'][$i];
    $size = (int) $upload['size'][$i];
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!isset(FILE_SIGNATURES[$ext]) || mb_strlen($name) > 200 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
      $errors[] = 'PDFまたはJWWファイルを添付してください。'; continue;
    }
    if ($size <= 0 || $size > max_file_size()) { $errors[] = 'ファイルは1つあたり' . format_mb(max_file_size()) . 'までです。'; continue; }
    if (!is_uploaded_file($tmp)) { $errors[] = 'ファイルを受け取れませんでした。'; continue; }
    // 拡張子だけ .pdf / .jww に変えた別の形式のファイル(実行ファイルなど)を受け付けない
    $head = (string) file_get_contents($tmp, false, null, 0, strlen(FILE_SIGNATURES[$ext]));
    if ($head !== FILE_SIGNATURES[$ext]) { $errors[] = $name . ' は' . strtoupper($ext) . 'ファイルの形式ではありません。'; continue; }
    $count[$ext]++;
    $files[] = ['name' => $name, 'size' => $size, 'tmp' => $tmp, 'type' => $ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'];
  }
  if (!$files && !$errors) $errors[] = '図面ファイルを添付してください。';
  if ($count['pdf'] > MAX_FILES_PER_TYPE || $count['jww'] > MAX_FILES_PER_TYPE) $errors[] = 'PDFとJWWは、それぞれ10ファイルまで添付できます。';
  return [$files, array_values(array_unique($errors))];
}

// ---- 外部への送信 ----

function http(string $method, string $url, array $headers = [], $body = null, int $timeout = 60): array {
  $responseHeaders = [];
  $ch = curl_init($url);
  if ($ch === false) throw new RuntimeException('curl_init failed');
  $options = [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
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
  ];
  if (is_resource($body)) { // ファイルはメモリに読み込まず、そのまま流す
    $options[CURLOPT_UPLOAD] = true;
    $options[CURLOPT_INFILE] = $body;
    $options[CURLOPT_FOLLOWLOCATION] = false;
  } elseif ($body !== null) {
    $options[CURLOPT_POSTFIELDS] = $body;
  }
  curl_setopt_array($ch, $options);
  $result = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  if ($result === false) throw new RuntimeException('HTTP request failed');
  return [$status, (string) $result, $responseHeaders];
}

function script_request(array $data, int $timeout = 60): array {
  $env = env();
  [$status, $body] = http('POST', $env['APPS_SCRIPT_URL'], ['Content-Type: text/plain;charset=UTF-8'],
    json_encode($data + ['secret' => $env['SHARED_SECRET']], JSON_UNESCAPED_UNICODE), $timeout);
  $result = json_decode($body, true);
  if ($status !== 200 || !is_array($result) || empty($result['ok'])) throw new RuntimeException('Apps Script failed');
  return $result;
}

function upload_to_drive(array $file, string $url): void {
  $prefix = env()['UPLOAD_URL_PREFIX'] ?? DRIVE_UPLOAD_PREFIX; // テストでだけ差し替える
  if (strpos($url, $prefix) !== 0) throw new RuntimeException('Invalid upload destination');
  $fp = fopen($file['tmp'], 'rb');
  if (!$fp) throw new RuntimeException('Cannot open upload');
  try {
    [$status] = http('PUT', $url, ['Content-Type: ' . $file['type'], 'Content-Length: ' . $file['size']], $fp, 600);
  } finally {
    fclose($fp);
  }
  if ($status < 200 || $status >= 300) throw new RuntimeException('Drive upload failed: ' . $status);
}

/** 受付の本体。ドライブへの保存と記録を Apps Script に頼む */
function submit_receipt(array $fields, array $files): void {
  @set_time_limit(900);
  $prepared = script_request(['action' => 'prepare', 'company' => $fields['company'],
    'files' => array_map(function ($f) { return ['name' => $f['name'], 'size' => $f['size']]; }, $files)]);
  foreach ($prepared['uploads'] as $i => $upload) upload_to_drive($files[$i], (string) $upload['url']);
  // Apps Script が PDF の中身を検査するので、記録の完了まで数分かかることがある
  script_request(['action' => 'finish', 'folderId' => $prepared['folderId'],
    'files' => array_map(function ($u) { return ['id' => $u['id'], 'size' => $u['size'], 'name' => $u['name']]; }, $prepared['uploads'])]
    + $fields, 300);
}

/** POST を処理する。@return string[] 画面に出すエラー。空なら受付完了 */
function handle_post(array $post, $upload, string $ip): array {
  $env = env();
  foreach (['APPS_SCRIPT_URL', 'SHARED_SECRET'] as $key) {
    if (empty($env[$key])) return ['現在、受付の準備中です。担当者にお問い合わせください。'];
  }
  // 人には見えない入力欄。ボットだけが埋める
  if (($post['website'] ?? '') !== '') return ['送信できませんでした。'];
  if (token_used($post['token'] ?? null)) return ['このフォームは送信済みです。重複を避けるため、もう一度送る前に担当者へご確認ください。'];
  [$fields, $errors] = validate_fields($post);
  [$files, $fileErrors] = validate_files($upload);
  $errors = array_merge($errors, $fileErrors);
  if ($errors) return $errors;
  $tokenError = check_form_token($post['token'] ?? null);
  if ($tokenError !== null) return [$tokenError];
  if (!within_hourly_limit(client_key($ip), env_int('RATE_LIMIT_PER_HOUR', 5))) {
    return ['送信回数の上限に達しました。しばらく時間をおいてお試しください。'];
  }
  // 送信元を変えながら大量に送られた場合に備え、全体の件数とアップロード量にも1時間あたりの上限を置く
  $bytes = (int) array_sum(array_column($files, 'size'));
  if (!within_hourly_limit('global-count', env_int('GLOBAL_LIMIT_PER_HOUR', 60)) ||
      !within_hourly_limit('global-bytes', env_int('GLOBAL_UPLOAD_MB_PER_HOUR', 2048) * 1024 * 1024, $bytes)) {
    error_log('kaito-form: global hourly limit reached');
    return ['現在、受付が混み合っております。しばらく時間をおいてお試しください。'];
  }
  submit_receipt($fields, $files);
  return [];
}
