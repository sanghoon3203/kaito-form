<?php
// 動作確認: php tests/wp-plugin.test.php
// WordPress プラグインとしての入口(kaito-form.php)を、WordPress の代わり(tests/wp-stub.php)の上で通しで確かめる。
// 本物の WordPress は使わないので、管理画面の設定ページは確かめない。
$root = dirname(__DIR__);
$tmp = sys_get_temp_dir();
$uploads = "$tmp/kaito-wp-uploads-" . getmypid();
$options = "$tmp/kaito-wp-options-" . getmypid() . '.json';
mkdir($uploads);
file_put_contents($options, json_encode([
  'APPS_SCRIPT_URL' => 'http://127.0.0.1:8792/mock-apps-script.php', 'SHARED_SECRET' => 'test-secret',
  'TURNSTILE_SITE_KEY' => '1x00000000000000000000AA', 'TURNSTILE_SECRET' => '1x0000000000000000000000000000000AA',
  'UPLOAD_URL_PREFIX' => 'http://127.0.0.1:8792/mock-upload.php', 'MIN_FORM_SECONDS' => '0', 'TEST_NOW' => '2026-11-11 13:00',
  'EMPTY' => '',
]));
$env = ['KAITO_WP_OPTIONS' => $options, 'KAITO_WP_UPLOADS' => $uploads] + getenv();
$null = [['pipe', 'r'], ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'w'], ['file', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null', 'w']];
$app = proc_open([PHP_BINARY, '-S', '127.0.0.1:8796', "$root/tests/wp-stub.php"], $null, $p1, $root, $env);
$mock = proc_open([PHP_BINARY, '-S', '127.0.0.1:8792', '-t', "$root/tests"], $null, $p2, $root);
usleep(900000);

$failed = 0;
function check(string $label, bool $ok, string $detail = ''): void {
  global $failed;
  echo ($ok ? 'ok   ' : 'FAIL '), $label, $ok ? '' : "  $detail", "\n";
  if (!$ok) $failed++;
}
function request(string $path, ?array $post = null): array {
  $headers = [];
  $ch = curl_init('http://127.0.0.1:8796' . $path);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
    $parts = explode(':', $line, 2);
    if (count($parts) === 2) $headers[strtolower(trim($parts[0]))] = trim($parts[1]);
    return strlen($line);
  }]);
  if ($post !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $post);
  $body = (string) curl_exec($ch);
  return [curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $body, $headers];
}

try {
  [$s, $body, $h] = request('/support/');
  check('the page with [kaito_form] shows the form, not the theme', $s === 200 && strpos($body, 'name="drawing[]"') !== false && strpos($body, 'THEME PAGE') === false);
  check('the page is not cacheable and keeps the strict CSP', strpos($h['cache-control'] ?? '', 'no-store') !== false &&
    strpos($h['content-security-policy'] ?? '', "default-src 'none'") !== false);
  preg_match('/name="token" value="([^"]+)"/', $body, $m);

  $pdf = "$tmp/kaito-wp-test.pdf";
  file_put_contents($pdf, '%PDF-1.7 test');
  $company = "O'Brien \"建設\" \\ 株式会社";
  [$s, $body, $h] = request('/support/', [
    'token' => $m[1] ?? '', 'website' => '', 'company' => $company, 'branch' => '新潟支店', 'contact' => '山田', 'email' => 'test@example.com',
    'projectSei' => '山田', 'projectMei' => '太郎', 'pref' => '大阪府', 'city' => '大阪市', 'street' => '1-2-3', 'heating' => 'AC',
    'start' => '2026-12-01', 'finish' => '2026-12-20', 'deadline' => '2026-11-30', 'rush' => '希望しない', 'note' => "it's ok",
    'cf-turnstile-response' => 'XXXX.DUMMY.TOKEN', 'drawing[0]' => new CURLFile($pdf, 'application/pdf', 'plan.pdf'),
  ]);
  check('a valid submission redirects to the same page with kaito_done', $s === 303 &&
    ($h['location'] ?? '') === 'http://127.0.0.1:8796/support/?kaito_done=1', "status $s " . strip_tags(substr($body, 0, 300)));
  $done = json_decode((string) @file_get_contents("$tmp/kaito-mock-finish.json"), true);
  check('the backslashes WordPress adds are removed', ($done['company'] ?? '') === $company && ($done['note'] ?? '') === "it's ok",
    json_encode($done['company'] ?? null, JSON_UNESCAPED_UNICODE));
  check('settings reach the form code, empty ones are dropped', !isset($done['EMPTY']) && ($done['delivery'] ?? '') === '2026-11-30');

  [$s, $body] = request('/support/?kaito_done=1');
  check('the completion page links back to the form page', $s === 200 && strpos($body, '受け付けました') !== false &&
    strpos($body, 'href="http://127.0.0.1:8796/support/"') !== false && strpos($body, 'THEME PAGE') === false);

  [$s, $body] = request('/support/?locked=1');
  check('a password-protected page is left to WordPress', strpos($body, 'THEME PAGE') !== false && strpos($body, 'name="drawing[]"') === false);

  check('the data folder under uploads is closed to browsers', is_file("$uploads/kaito-form/.htaccess") &&
    strpos((string) file_get_contents("$uploads/kaito-form/.htaccess"), 'denied') !== false);
} finally {
  proc_terminate($app); proc_terminate($mock);
  array_map('unlink', array_merge(glob("$uploads/kaito-form/*") ?: [], glob("$uploads/kaito-form/.ht*") ?: []));
  @rmdir("$uploads/kaito-form"); @rmdir($uploads); @unlink($options); @unlink($pdf ?? '');
}
exit($failed ? 1 : 0);
