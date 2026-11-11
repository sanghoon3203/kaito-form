<?php
// 受付フォームの処理。ブラウザ側の JavaScript は使わない(通常の HTML フォームを PHP が受け取る)。
// PHP 7.4+ と curl・mbstring・openssl 拡張が必要。設定は .env(public の一つ上)から読む。.env.example を参照。
declare(strict_types=1);

const MAX_FILE_SIZE = 8 * 1024 * 1024;   // 1ファイルの上限
const MAX_TOTAL_SIZE = 80 * 1024 * 1024; // 1回の送信で添付できる合計
const MAX_FILES = 10;                    // PDF と JWW を合わせた個数
const FILE_SIGNATURES = ['pdf' => '%PDF-', 'jww' => 'JwwData.']; // ファイル先頭の決まった文字列
const HEATING_TYPES = ['放熱器', 'AC', 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ']; // 案件基本情報「床下暖房種別」のプルダウンと同じ表記
// 納期の短縮の選択肢 => 受付日から納品までの営業日数
const RUSH_OPTIONS = ['希望しない' => 4, '翌営業日（+3万円）' => 1, '2営業日後（+2万円）' => 2, '3営業日後（+1万円）' => 3];
const BUSINESS_CLOSE = '17:30'; // 営業時間は平日 8:30〜17:30。これを過ぎた申し込みは翌営業日の受付
// 土日のほかに休む日(国民の祝日)。年末年始などの休業日や、2028年以降の祝日はここに足す
const HOLIDAYS = ['2026-11-23', '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-22', '2027-04-29',
  '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23', '2027-10-11',
  '2027-11-03', '2027-11-23'];
const PREFECTURES = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県',
  '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県',
  '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
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

/** このリクエストだけで使える値。ページ内の自前のスクリプトには、この値を付けたものだけ実行を許す */
function csp_nonce(): string {
  static $nonce = null;
  return $nonce ?? ($nonce = base64_encode(random_bytes(16)));
}

function send_security_headers(): void {
  header('X-Content-Type-Options: nosniff');
  header('Referrer-Policy: no-referrer');
  header('X-Frame-Options: DENY');
  // 実行できる JavaScript は、Cloudflare Turnstile と、nonce を付けたページ内のスクリプトだけ。フォントは Google Fonts から読む
  header("Content-Security-Policy: default-src 'none'; script-src 'nonce-" . csp_nonce() . "' https://challenges.cloudflare.com; " .
    "frame-src https://challenges.cloudflare.com; style-src 'unsafe-inline' https://fonts.googleapis.com; " .
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
 * 直近1時間の記録をロックして読み、$change で書き換える。記録は [時刻, 量, 受付ID] の並び。
 * ponytail: キーごとにファイル1つで管理。受付が多くなったら DB へ
 */
function update_hourly(string $key, callable $change) {
  $fp = fopen(data_dir() . '/rate-' . hash('sha256', $key) . '.json', 'c+');
  if (!$fp) throw new RuntimeException('Cannot write data dir');
  flock($fp, LOCK_EX);
  $entries = array_values(array_filter((array) json_decode((string) stream_get_contents($fp), true), function ($e) {
    return is_array($e) && is_int($e[0] ?? null) && is_int($e[1] ?? null) && is_string($e[2] ?? null) && $e[0] > time() - 3600;
  }));
  [$entries, $result] = $change($entries);
  ftruncate($fp, 0); rewind($fp); fwrite($fp, json_encode(array_values($entries)));
  flock($fp, LOCK_UN); fclose($fp);
  return $result;
}

/** 合計が $limit 以内に収まるときだけ $amount を予約する */
function reserve(string $key, int $limit, int $amount, string $id): bool {
  return update_hourly($key, function (array $entries) use ($limit, $amount, $id) {
    $ok = array_sum(array_column($entries, 1)) + $amount <= $limit;
    if ($ok) $entries[] = [time(), $amount, $id];
    return [$entries, $ok];
  });
}

function release(string $key, string $id): void {
  update_hourly($key, function (array $entries) use ($id) {
    return [array_filter($entries, function ($e) use ($id) { return $e[2] !== $id; }), null];
  });
}

/**
 * 送信回数と容量の上限をまとめて予約する。どれか1つでも超えたら、予約済みの分を戻してエラーを返す。
 * @return array{0: ?string, 1: string[]} エラーメッセージ(なければ null)と予約したキー
 */
function reserve_quota(string $ip, int $bytes, string $id): array {
  $mb = 1024 * 1024;
  $client = client_key($ip);
  $busy = '現在、受付が混み合っております。しばらく時間をおいてお試しください。';
  $tooMany = '送信回数の上限に達しました。しばらく時間をおいてお試しください。';
  // 全体の上限は、1つの送信元の上限より十分大きくしておく。小さいと、少数の送信元だけで全体を止められてしまう
  $limits = [
    [$client, env_int('RATE_LIMIT_PER_HOUR', 5), 1, $tooMany],
    ['bytes:' . $client, env_int('CLIENT_UPLOAD_MB_PER_HOUR', 300) * $mb, $bytes, $tooMany],
    ['global-count', env_int('GLOBAL_LIMIT_PER_HOUR', 200), 1, $busy],
    ['global-bytes', env_int('GLOBAL_UPLOAD_MB_PER_HOUR', 10240) * $mb, $bytes, $busy],
  ];
  $reserved = [];
  foreach ($limits as [$key, $limit, $amount, $message]) {
    if (!reserve($key, $limit, $amount, $id)) {
      foreach ($reserved as $done) release($done, $id);
      if ($message === $busy) error_log('kaito-form: global hourly limit reached');
      return [$message, []];
    }
    $reserved[] = $key;
  }
  return [null, $reserved];
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
// php.ini の設定がこれより小さい場合は、そちらに合わせる(超えると PHP が受け取れないため)
function max_total_size(): int { return min(MAX_TOTAL_SIZE, ini_bytes('post_max_size') ?: MAX_TOTAL_SIZE); }

function format_mb(int $bytes): string { return rtrim(rtrim(number_format($bytes / 1024 / 1024, 1), '0'), '.') . 'MB'; }

function is_business_day(DateTimeImmutable $d): bool {
  return (int) $d->format('N') < 6 && !in_array($d->format('Y-m-d'), HOLIDAYS, true);
}

function add_business_days(DateTimeImmutable $d, int $n): DateTimeImmutable {
  while ($n > 0) { $d = $d->modify('+1 day'); if (is_business_day($d)) $n--; }
  return $d;
}

/**
 * 図面の納品予定日(Y-m-d)。受付日(営業時間を過ぎていれば翌営業日)を除いて数える。
 * 短縮なしは4営業日後。希望納期がそれより後なら希望納期。短縮ありは選んだ営業日数後。
 */
function delivery_date(string $rush, string $deadline, ?DateTimeImmutable $now = null): string {
  $now = $now ?? new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
  $received = $now->setTime(0, 0);
  if (!is_business_day($received) || $now->format('H:i') > BUSINESS_CLOSE) $received = add_business_days($received, 1);
  $days = RUSH_OPTIONS[$rush] ?? RUSH_OPTIONS['希望しない'];
  $date = add_business_days($received, $days)->format('Y-m-d');
  $noRush = $days === RUSH_OPTIONS['希望しない'];
  return $noRush && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $deadline) && $deadline > $date ? $deadline : $date;
}

/** 2026-11-17 → 2026/11/17（火） */
function jp_date(string $ymd): string {
  $d = new DateTimeImmutable($ymd);
  return $d->format('Y/m/d') . '（' . ['日', '月', '火', '水', '木', '金', '土'][(int) $d->format('w')] . '）';
}

/** @return array{0: array, 1: string[]} 整えた入力値とエラーメッセージ */
function validate_fields(array $post): array {
  $limits = ['company' => 100, 'branch' => 100, 'contact' => 100, 'email' => 254, 'projectSei' => 50, 'projectMei' => 50,
    'pref' => 10, 'city' => 100, 'street' => 200, 'heating' => 20, 'start' => 10, 'finish' => 10, 'deadline' => 10,
    'rush' => 30, 'note' => 1000];
  $fields = [];
  $errors = [];
  foreach ($limits as $name => $max) {
    $value = isset($post[$name]) && is_string($post[$name]) ? trim(str_replace("\r\n", "\n", $post[$name])) : '';
    if (mb_strlen($value) > $max) { $errors[] = '入力が長すぎる項目があります。'; $value = mb_substr($value, 0, $max); }
    $fields[$name] = $value;
  }
  $required = ['company' => '会社名', 'branch' => '支店名', 'contact' => 'ご担当者名', 'email' => 'メールアドレス',
    'projectSei' => '案件名の姓', 'projectMei' => '案件名の名', 'pref' => '都道府県', 'city' => '市区町村',
    'street' => '丁目番地・建物名・部屋番号', 'heating' => '床下暖房種別', 'start' => '着工予定日', 'finish' => '完工予定日',
    'deadline' => '図面の希望納期', 'rush' => '納期の短縮'];
  foreach ($required as $name => $label) {
    if ($fields[$name] === '') $errors[] = $label . 'をご入力ください。';
  }
  if ($fields['email'] !== '' && (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL) ||
      preg_match('/[^\x21-\x7e]/', $fields['email']))) { // 半角・全角スペースや全角文字を含むものは受け付けない
    $errors[] = 'メールアドレスは半角英数字でご入力ください。';
  }
  if ($fields['heating'] !== '' && $fields['heating'] !== '未定' && !in_array($fields['heating'], HEATING_TYPES, true)) $errors[] = '床下暖房種別をご確認ください。';
  if ($fields['pref'] !== '' && !in_array($fields['pref'], PREFECTURES, true)) $errors[] = '都道府県をご確認ください。';
  if ($fields['rush'] !== '' && !isset(RUSH_OPTIONS[$fields['rush']])) $errors[] = '納期の短縮をご確認ください。';
  foreach (['start' => '着工予定日', 'finish' => '完工予定日', 'deadline' => '図面の希望納期'] as $name => $label) {
    $d = explode('-', $fields[$name]);
    if ($fields[$name] !== '' && !(preg_match('/^\d{4}-\d{2}-\d{2}$/D', $fields[$name]) && checkdate((int) $d[1], (int) $d[2], (int) $d[0]))) {
      $errors[] = $label . 'をご確認ください。';
    }
  }
  // 案件管理表には「案件名」「案件住所」の1列ずつで書く
  $fields['projectName'] = $fields['projectSei'] . '　' . $fields['projectMei']; // 既存の行と同じく全角スペース
  $fields['projectAddress'] = $fields['pref'] . $fields['city'] . $fields['street'];
  if ($fields['heating'] === '未定') $fields['heating'] = ''; // 案件管理表では空欄が未定
  $fields['delivery'] = delivery_date($fields['rush'], $fields['deadline']); // 納品予定日は送信された時刻で決める
  return [$fields, array_values(array_unique($errors))];
}

/** $_FILES['drawing'] を確かめる。@return array{0: array, 1: string[]} */
function validate_files($upload): array {
  $files = [];
  $errors = [];
  if (!is_array($upload) || !is_array($upload['name'] ?? null)) return [[], ['図面ファイルを添付してください。']];
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
    $files[] = ['name' => $name, 'size' => $size, 'tmp' => $tmp, 'type' => $ext === 'pdf' ? 'application/pdf' : 'application/octet-stream'];
  }
  if (!$files && !$errors) $errors[] = '図面ファイルを添付してください。';
  if (count($files) > MAX_FILES) $errors[] = 'ファイルは合計' . MAX_FILES . '個まで添付できます。';
  if (array_sum(array_column($files, 'size')) > max_total_size()) $errors[] = 'ファイルは合計' . format_mb(max_total_size()) . 'まで添付できます。';
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
  if ($method === 'POST') {
    // Apps Script は POST に 302 で応え、応答を GET で取りに行かせる。CUSTOMREQUEST だと POST のまま追いかけて 405 になる
    unset($options[CURLOPT_CUSTOMREQUEST]);
    $options[CURLOPT_POST] = true;
  }
  curl_setopt_array($ch, $options);
  $result = curl_exec($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  if ($result === false) throw new RuntimeException('HTTP request failed');
  return [$status, (string) $result, $responseHeaders];
}

/** Cloudflare Turnstile の結果をサーバー側で確かめる(ブラウザの判定だけを信用しない) */
function verify_turnstile($token, string $ip): bool {
  if (!is_string($token) || $token === '' || strlen($token) > 2048) return false;
  [$status, $body] = http('POST', 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    ['Content-Type: application/x-www-form-urlencoded'],
    http_build_query(['secret' => env()['TURNSTILE_SECRET'] ?? '', 'response' => $token, 'remoteip' => $ip]), 15);
  $result = json_decode($body, true);
  return $status === 200 && is_array($result) && ($result['success'] ?? false) === true;
}

function script_request(array $data, int $timeout = 60): array {
  $env = env();
  [$status, $body] = http('POST', $env['APPS_SCRIPT_URL'], ['Content-Type: text/plain;charset=UTF-8'],
    json_encode($data + ['secret' => $env['SHARED_SECRET']], JSON_UNESCAPED_UNICODE), $timeout);
  $result = json_decode($body, true);
  if ($status !== 200 || !is_array($result) || empty($result['ok'])) {
    throw new RuntimeException('Apps Script failed: ' . ($data['action'] ?? '') . ' ' . $status . ' ' . (is_array($result) ? (string) ($result['error'] ?? '') : ''));
  }
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
  foreach (['APPS_SCRIPT_URL', 'SHARED_SECRET', 'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET'] as $key) {
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
  if (!verify_turnstile($post['cf-turnstile-response'] ?? '', $ip)) {
    return ['「私はロボットではありません」の確認が完了しませんでした。もう一度お試しください。'];
  }
  // 送信元ごとと全体の、件数とアップロード量の上限(1時間あたり)。
  // ここで数えた分は、この後の処理が失敗しても戻さない(失敗させて上限を回避されないように)
  [$quotaError] = reserve_quota($ip, (int) array_sum(array_column($files, 'size')), bin2hex(random_bytes(8)));
  if ($quotaError !== null) return [$quotaError];
  submit_receipt($fields, $files);
  return [];
}
