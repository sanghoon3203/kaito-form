<?php
// 動作確認: php tests/smoke.php
// public/ と偽の Apps Script・偽のドライブ送信先を php -S で起動し、HTML フォームの送信を通しで確かめる。
$root = dirname(__DIR__);
$tmp = sys_get_temp_dir();
$env = "$tmp/kaito-test.env";
$dataDir = "$tmp/kaito-test-data-" . getmypid();
@mkdir($dataDir);
function write_env(array $extra = []) {
  global $env, $dataDir;
  file_put_contents($env, implode("\n", array_merge([
    'APPS_SCRIPT_URL=http://127.0.0.1:8792/mock-apps-script.php',
    'SHARED_SECRET=test-secret',
    "DATA_DIR=$dataDir",
    'UPLOAD_URL_PREFIX=http://127.0.0.1:8792/mock-upload.php',
    // Cloudflare のテスト用キー(常に成功)。後ろに同じキーを書けば上書きできる
    'TURNSTILE_SITE_KEY=1x00000000000000000000AA',
    'TURNSTILE_SECRET=1x0000000000000000000000000000000AA',
  ], $extra)));
}
write_env(['MIN_FORM_SECONDS=0', 'RATE_LIMIT_PER_HOUR=1000']);
$php = PHP_BINARY;
$spec = [['pipe', 'r'], ['file', "$tmp/kaito-server.log", 'a'], ['file', "$tmp/kaito-server.log", 'a']];
putenv("KAITO_ENV_FILE=$env");
$app = proc_open([$php, '-S', '127.0.0.1:8791', '-t', "$root/public"], $spec, $p1);
$mock = proc_open([$php, '-S', '127.0.0.1:8792', '-t', "$root/tests"], $spec, $p2);
usleep(800000);

function request(string $path, ?array $post = null): array {
  $headers = [];
  $ch = curl_init("http://127.0.0.1:8791/$path");
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
    $parts = explode(':', $line, 2);
    if (count($parts) === 2) $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
    return strlen($line);
  }]);
  if ($post !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
  $body = (string) curl_exec($ch);
  return [curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $body, $headers];
}
function token(): string {
  [, $body] = request('index.php');
  preg_match('/name="token" value="([^"]+)"/', $body, $m);
  return $m[1] ?? '';
}
function file_of(string $name, string $content) {
  $path = sys_get_temp_dir() . '/kaito-' . $name;
  file_put_contents($path, $content);
  return new CURLFile($path, '', $name);
}
$failed = 0;
function check($name, $ok, $detail = '') { global $failed; echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok ? '' : "  $detail") . "\n"; if (!$ok) $failed++; }

$pdf = '%PDF-1.7 test drawing';
$jww = "JwwData.\xc8\x02\x00\x00 test";
$fields = ['company' => 'テスト工務店', 'branch' => '大阪支店', 'contact' => '山田', 'email' => 'test@example.com',
  'projectSei' => '山田', 'projectMei' => '太郎', 'pref' => '大阪府', 'city' => '大阪市', 'street' => '1-2-3',
  'heating' => 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ', 'start' => '2026-12-01', 'finish' => '2026-12-20', 'deadline' => '2026-11-20',
  'rush' => '2営業日後（+2万円）', 'note' => '=SUM(A1)', 'website' => '', 'cf-turnstile-response' => 'XXXX.DUMMY.TOKEN'];
$form = function (array $override = [], ?array $files = null) use ($fields, $pdf, $jww) {
  $files = $files ?? ['drawing[0]' => file_of('plan.pdf', $pdf), 'drawing[1]' => file_of('plan.jww', $jww)];
  return $override + ['token' => token()] + $fields + $files;
};

try {
  [$s, $body, $h] = request('index.php');
  check('form page renders', $s === 200 && strpos($body, 'お問い合わせ') !== false && strpos($body, 'サポート') !== false);
  $csp = $h['content-security-policy'] ?? '';
  preg_match("/'nonce-([A-Za-z0-9+\/=]+)'/", $csp, $nonce);
  preg_match_all('/<script\b[^>]*>/i', $body, $scripts);
  check('scripts are only Turnstile and the nonce-tagged file list', count($scripts[0]) === 2 &&
    strpos($scripts[0][0], 'src="https://challenges.cloudflare.com/turnstile/v0/api.js"') !== false &&
    isset($nonce[1]) && $scripts[0][1] === '<script nonce="' . $nonce[1] . '">' &&
    stripos($body, 'javascript:') === false && !preg_match('/\son[a-z]+=/i', $body));
  check('Turnstile widget has the site key', strpos($body, 'data-sitekey="1x00000000000000000000AA"') !== false);
  check('CSP allows only Cloudflare and the nonce', strpos($csp, "default-src 'none'") !== false &&
    preg_match("~script-src 'nonce-[A-Za-z0-9+/=]+' https://challenges\.cloudflare\.com;~", $csp) === 1);
  [, , $h2] = request('index.php');
  check('nonce changes on every request', ($h2['content-security-policy'] ?? '') !== $csp);
  check('file input works without JavaScript too', strpos($body, 'name="drawing[]"') !== false && strpos($body, 'multiple required') !== false);
  check('expected delivery date is shown with both date sets', preg_match('/id="delivery-date"[^>]*>\d{4}\/\d{2}\/\d{2}（.）</u', $body) === 1 &&
    strpos($body, 'data-late-dates=') !== false && strpos($body, 'data-late-in=') !== false);
  check('old heading is gone', strpos($body, 'お申し込みフォーム') === false && strpos($body, 'お申し込み受付') === false);

  $post = $form();
  [$s, $body, $h] = request('index.php', $post);
  check('valid submission redirects to complete page', $s === 303 && ($h['location'] ?? '') === 'complete.php', "status $s " . strip_tags(substr($body, 0, 300)));
  $done = json_decode((string) @file_get_contents("$tmp/kaito-mock-finish.json"), true);
  check('finish sends all case fields', ($done['projectAddress'] ?? '') === '大阪府大阪市1-2-3' && ($done['heating'] ?? '') === 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ' &&
    ($done['projectName'] ?? '') === '山田　太郎' && ($done['finish'] ?? '') === '2026-12-20' && ($done['rush'] ?? '') === '2営業日後（+2万円）' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $done['delivery'] ?? '') === 1 &&
    ($done['folderId'] ?? '') === 'FOLDER' && count($done['files'] ?? []) === 2 && !isset($done['website']) && !isset($done['token']));
  check('files reach Drive unchanged', @file_get_contents("$tmp/kaito-upload-ID0.bin") === $pdf && @file_get_contents("$tmp/kaito-upload-ID1.bin") === $jww);

  [$s, $body] = request('index.php', ['token' => $post['token']] + $post);
  check('same form cannot be sent twice', $s === 422 && strpos($body, '送信済み') !== false);

  [$s, $body] = request('index.php', $form(['website' => 'http://spam.example']));
  check('honeypot blocks bots', $s === 422);
  [$s, $body] = request('index.php', $form(['token' => '1700000000.' . str_repeat('a', 24) . '.' . str_repeat('b', 64)]));
  check('forged token is rejected', $s === 422 && strpos($body, '有効期限') !== false);
  [$s, $body] = request('index.php', $form(['projectMei' => '']));
  check('missing 案件名の名 is rejected', $s === 422 && strpos($body, '案件名の名をご入力ください') !== false);
  foreach (['branch' => '支店名', 'finish' => '完工予定日', 'deadline' => '図面の希望納期', 'heating' => '床下暖房種別'] as $name => $label) {
    [$s, $body] = request('index.php', $form([$name => '']));
    check("missing $label is rejected", $s === 422 && strpos($body, $label . 'をご入力ください') !== false);
  }
  [$s, $body] = request('index.php', $form(['pref' => '東京']));
  check('unknown 都道府県 is rejected', $s === 422 && strpos($body, '都道府県をご確認ください') !== false);
  [$s, $body] = request('index.php', $form(['deadline' => '2026-02-30']));
  check('impossible date is rejected', $s === 422 && strpos($body, '図面の希望納期をご確認ください') !== false);
  check('entered values are kept after an error', strpos($body, 'value="テスト工務店"') !== false && strpos($body, '>=SUM(A1)</textarea>') !== false);
  foreach (['a b@example.com', "a\u{3000}b@example.com", 'ａｂｃ＠ｅｘａｍｐｌｅ．ｃｏｍ', 'テスト@example.com'] as $bad) {
    [$s, $body] = request('index.php', $form(['email' => $bad]));
    check('email ' . json_encode($bad, JSON_UNESCAPED_UNICODE) . ' is rejected', $s === 422 && strpos($body, 'メールアドレスは半角英数字') !== false);
  }
  [$s, $body] = request('index.php', $form([], ['drawing[0]' => file_of('fake.pdf', 'MZ this is an exe')]));
  check('.pdf that is not a PDF is rejected', $s === 422 && strpos($body, 'fake.pdf は') !== false);
  [$s, $body] = request('index.php', $form([], ['drawing[0]' => file_of('fake.jww', 'MZ this is an exe')]));
  check('.jww that is not a JWW is rejected', $s === 422 && strpos($body, 'fake.jww は') !== false);
  [$s, $body] = request('index.php', $form([], ['drawing[0]' => file_of('virus.exe', 'MZ')]));
  check('other file types are rejected', $s === 422 && strpos($body, 'PDFまたはJWW') !== false);
  [$s, $body] = request('index.php', $form([], []));
  check('missing file is rejected', $s === 422 && strpos($body, '図面ファイルを添付してください') !== false);
  $tooMany = [];
  for ($i = 0; $i < 11; $i++) $tooMany["drawing[$i]"] = $i % 2 ? file_of("p$i.jww", $jww) : file_of("p$i.pdf", $pdf);
  [$s, $body] = request('index.php', $form([], $tooMany));
  check('more than 10 files in total are rejected', $s === 422 && strpos($body, '合計10個まで') !== false);
  $ten = array_slice($tooMany, 0, 10, true);
  [$s] = request('index.php', $form([], $ten));
  check('10 files in total are accepted', $s === 303);
  [$s, $body] = request('index.php', $form([], ['drawing[0]' => file_of('big.pdf', '%PDF-' . str_repeat('x', 8 * 1024 * 1024))]));
  check('file over 8MB is rejected', $s === 422 && strpos($body, '1つあたり8MBまで') !== false);
  [, $body] = request('index.php');
  check('limits are shown on the form', strpos($body, '合計10個まで') !== false && strpos($body, '1ファイル8MBまで') !== false &&
    strpos($body, '合計80MBまで') !== false);

  write_env(['MIN_FORM_SECONDS=0', 'RATE_LIMIT_PER_HOUR=1000', 'TURNSTILE_SECRET=2x0000000000000000000000000000000AA']);
  [$s, $body] = request('index.php', $form());
  check('failed Turnstile check is rejected', $s === 422 && strpos($body, '確認が完了しませんでした') !== false);
  [$s, $body] = request('index.php', $form(['cf-turnstile-response' => '']));
  check('missing Turnstile token is rejected', $s === 422 && strpos($body, '確認が完了しませんでした') !== false);

  write_env(['MIN_FORM_SECONDS=5', 'RATE_LIMIT_PER_HOUR=1000']);
  [$s, $body] = request('index.php', $form());
  check('submitting too fast is rejected', $s === 422 && strpos($body, '早すぎます') !== false);

  write_env(['MIN_FORM_SECONDS=0', 'RATE_LIMIT_PER_HOUR=1']);
  [$s, $body] = request('index.php', $form());
  check('rate limit per IP', $s === 422 && strpos($body, '上限') !== false);

  write_env(['MIN_FORM_SECONDS=0', 'RATE_LIMIT_PER_HOUR=1000', 'GLOBAL_LIMIT_PER_HOUR=1']);
  [$s, $body] = request('index.php', $form());
  check('global hourly cap on submissions', $s === 422 && strpos($body, '混み合って') !== false);
  write_env(['MIN_FORM_SECONDS=0', 'RATE_LIMIT_PER_HOUR=1000', 'GLOBAL_LIMIT_PER_HOUR=1000', 'GLOBAL_UPLOAD_MB_PER_HOUR=0']);
  [$s, $body] = request('index.php', $form());
  check('global hourly cap on upload volume', $s === 422 && strpos($body, '混み合って') !== false);

  write_env(['RATE_LIMIT_PER_HOUR=2', 'CLIENT_UPLOAD_MB_PER_HOUR=1', 'GLOBAL_LIMIT_PER_HOUR=1000', 'GLOBAL_UPLOAD_MB_PER_HOUR=1000']);
  require $root . '/src/lib.php';
  $ip = '198.51.100.7';
  [$err] = reserve_quota($ip, 2 * 1024 * 1024, 'big');
  check('per-client upload volume cap', $err !== null && strpos($err, '上限') !== false);
  [$e1] = reserve_quota($ip, 1000, 'a');
  [$e2] = reserve_quota($ip, 1000, 'b');
  check('rejected requests do not use up quota', $e1 === null && $e2 === null, "$e1 / $e2");
  [$e3] = reserve_quota($ip, 1000, 'c');
  check('per-client count still applies', $e3 !== null);

  check('IPv6 addresses in one /64 share a limit', client_key('2001:db8:1:2::1') === client_key('2001:db8:1:2:ffff::9') &&
    client_key('2001:db8:1:2::1') !== client_key('2001:db8:1:3::1'));
  check('IPv4 and IPv4-mapped IPv6 are counted per address', client_key('::ffff:203.0.113.5') === client_key('203.0.113.5') &&
    client_key('203.0.113.5') !== client_key('203.0.113.6'));

  [$s, $body] = request('complete.php');
  check('complete page renders', $s === 200 && strpos($body, '受け付けました') !== false && stripos($body, '<script') === false);
} finally {
  proc_terminate($app); proc_terminate($mock);
  array_map('unlink', glob("$dataDir/*") ?: []); @rmdir($dataDir);
}
exit($failed ? 1 : 0);
