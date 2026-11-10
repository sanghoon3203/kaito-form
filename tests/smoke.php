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
  'projectName' => '山田様邸 新築工事', 'projectAddress' => '大阪府大阪市1-2-3', 'heating' => 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ',
  'start' => '2026-12-01', 'note' => '=SUM(A1)', 'website' => ''];
$form = function (array $override = [], ?array $files = null) use ($fields, $pdf, $jww) {
  $files = $files ?? ['drawing[0]' => file_of('plan.pdf', $pdf), 'drawing[1]' => file_of('plan.jww', $jww)];
  return $override + ['token' => token()] + $fields + $files;
};

try {
  [$s, $body, $h] = request('index.php');
  check('form page renders', $s === 200 && strpos($body, 'お問い合わせ') !== false && strpos($body, 'サポート') !== false);
  check('page has no JavaScript', stripos($body, '<script') === false && stripos($body, 'javascript:') === false &&
    !preg_match('/\son[a-z]+=/i', $body));
  check('CSP forbids scripts', strpos($h['content-security-policy'] ?? '', "default-src 'none'") !== false &&
    strpos($h['content-security-policy'] ?? '', 'script-src') === false);
  check('old heading is gone', strpos($body, 'お申し込みフォーム') === false && strpos($body, 'お申し込み受付') === false);

  $post = $form();
  [$s, $body, $h] = request('index.php', $post);
  check('valid submission redirects to complete page', $s === 303 && ($h['location'] ?? '') === 'complete.php', "status $s " . strip_tags(substr($body, 0, 300)));
  $done = json_decode((string) @file_get_contents("$tmp/kaito-mock-finish.json"), true);
  check('finish sends all case fields', ($done['projectAddress'] ?? '') === '大阪府大阪市1-2-3' && ($done['heating'] ?? '') === 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ' &&
    ($done['folderId'] ?? '') === 'FOLDER' && count($done['files'] ?? []) === 2 && !isset($done['website']) && !isset($done['token']));
  check('files reach Drive unchanged', @file_get_contents("$tmp/kaito-upload-ID0.bin") === $pdf && @file_get_contents("$tmp/kaito-upload-ID1.bin") === $jww);

  [$s, $body] = request('index.php', ['token' => $post['token']] + $post);
  check('same form cannot be sent twice', $s === 422 && strpos($body, '送信済み') !== false);

  [$s, $body] = request('index.php', $form(['website' => 'http://spam.example']));
  check('honeypot blocks bots', $s === 422);
  [$s, $body] = request('index.php', $form(['token' => '1700000000.' . str_repeat('a', 24) . '.' . str_repeat('b', 64)]));
  check('forged token is rejected', $s === 422 && strpos($body, '有効期限') !== false);
  [$s, $body] = request('index.php', $form(['projectName' => '']));
  check('missing 案件名 is rejected', $s === 422 && strpos($body, '案件名をご入力ください') !== false);
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
  for ($i = 0; $i < 11; $i++) $tooMany["drawing[$i]"] = file_of("p$i.pdf", $pdf);
  [$s, $body] = request('index.php', $form([], $tooMany));
  check('more than 10 PDFs are rejected', $s === 422 && strpos($body, '10ファイルまで') !== false);

  write_env(['MIN_FORM_SECONDS=5', 'RATE_LIMIT_PER_HOUR=1000']);
  [$s, $body] = request('index.php', $form());
  check('submitting too fast is rejected', $s === 422 && strpos($body, '早すぎます') !== false);

  write_env(['MIN_FORM_SECONDS=0', 'RATE_LIMIT_PER_HOUR=1']);
  [$s, $body] = request('index.php', $form());
  check('rate limit per IP', $s === 422 && strpos($body, '上限') !== false);

  [$s, $body] = request('complete.php');
  check('complete page renders', $s === 200 && strpos($body, '受け付けました') !== false && stripos($body, '<script') === false);
} finally {
  proc_terminate($app); proc_terminate($mock);
  array_map('unlink', glob("$dataDir/*") ?: []); @rmdir($dataDir);
}
exit($failed ? 1 : 0);
