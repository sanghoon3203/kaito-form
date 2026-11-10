<?php
// 動作確認: php tests/smoke.php
// api.php と偽の Apps Script を php -S で起動し、受付の流れを通す。
// Turnstile は Cloudflare のテスト用キー(常に成功)を使うため、ネットへの接続が必要。
$root = dirname(__DIR__);
$tmp = sys_get_temp_dir();
$env = "$tmp/kaito-test.env";
file_put_contents($env, implode("\n", [
  'APPS_SCRIPT_URL=http://127.0.0.1:8792/mock-apps-script.php',
  'SHARED_SECRET=test-secret',
  'TURNSTILE_SITE_KEY=1x00000000000000000000AA',
  'TURNSTILE_SECRET=1x0000000000000000000000000000000AA',
]));
$php = PHP_BINARY;
$spec = [['pipe', 'r'], ['file', "$tmp/kaito-server.log", 'a'], ['file', "$tmp/kaito-server.log", 'a']];
putenv("KAITO_ENV_FILE=$env");
$api = proc_open([$php, '-S', '127.0.0.1:8791', '-t', "$root/public"], $spec, $p1);
$mock = proc_open([$php, '-S', '127.0.0.1:8792', '-t', "$root/tests"], $spec, $p2);
usleep(800000);

function call($method, $path, $body = null, $headers = []) {
  $ch = curl_init("http://127.0.0.1:8791/$path");
  curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => array_merge(['Content-Type: application/json'], $headers)]);
  if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
  $out = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  return [$status, json_decode($out, true), $out];
}
$failed = 0;
function check($name, $ok, $detail = '') { global $failed; echo ($ok ? 'ok   ' : 'FAIL ') . $name . ($ok ? '' : "  $detail") . "\n"; if (!$ok) $failed++; }

$fields = ['company' => 'テスト工務店', 'branch' => '大阪支店', 'contact' => '山田', 'email' => 'test@example.com',
  'projectName' => '山田様邸 新築工事', 'projectAddress' => '大阪府大阪市1-2-3', 'heating' => 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ',
  'start' => '2026-12-01', 'note' => '=SUM(A1)'];
$files = [['name' => 'plan.pdf', 'size' => 1000]];

try {
  [$s, $r] = call('GET', 'api.php?action=config');
  check('config returns site key', $s === 200 && $r['siteKey'] === '1x00000000000000000000AA');

  [$s] = call('POST', 'api.php?action=prepare', ['projectName' => ''] + $fields + ['files' => $files, 'token' => 'x']);
  check('missing 案件名 is rejected', $s === 400);
  [$s] = call('POST', 'api.php?action=prepare', ['heating' => '床暖'] + $fields + ['files' => $files, 'token' => 'x']);
  check('unknown 床下暖房種別 is rejected', $s === 400);
  $badEmails = ['', '   ', 'a b@example.com', "a\u{3000}b@example.com", 'a@exa mple.com', 'ａｂｃ＠ｅｘａｍｐｌｅ．ｃｏｍ', 'abc＠example.com', 'テスト@example.com'];
  foreach ($badEmails as $bad) {
    [$s] = call('POST', 'api.php?action=prepare', ['email' => $bad] + $fields + ['files' => $files, 'token' => 'x']);
    check('email ' . json_encode($bad, JSON_UNESCAPED_UNICODE) . ' is rejected', $s === 400);
  }
  [$s] = call('POST', 'api.php?action=prepare', $fields + ['files' => [['name' => 'a.exe', 'size' => 1]], 'token' => 'x']);
  check('non PDF/JWW file is rejected', $s === 400);

  [$s, $r, $raw] = call('POST', 'api.php?action=prepare', $fields + ['files' => $files, 'token' => 'XXXX.DUMMY.TOKEN']);
  check('prepare succeeds with Turnstile test key', $s === 200 && count($r['uploads'] ?? []) === 1, $raw);
  $sent = json_decode((string) @file_get_contents("$tmp/kaito-mock-prepare.json"), true);
  check('prepare sends company and files to Apps Script', ($sent['company'] ?? '') === 'テスト工務店' && ($sent['files'][0]['name'] ?? '') === 'plan.pdf');

  [$s] = call('POST', 'api.php?action=upload', 'abc', ['X-Upload-Key: ' . $r['uploads'][0], 'X-Content-Range: bytes 0-2/999']);
  check('upload with wrong total size is rejected', $s === 400);
  [$s] = call('POST', 'api.php?action=upload', 'abc', ['X-Upload-Key: forged.key', 'X-Content-Range: bytes 0-2/1000']);
  check('forged upload key is rejected', $s === 403);
  $tampered = substr($r['receipt'], 0, -3) . 'AA=';
  [$s] = call('POST', 'api.php?action=finish', ['receipt' => $tampered]);
  check('tampered receipt is rejected', $s === 403);

  [$s] = call('POST', 'api.php?action=finish', ['receipt' => $r['receipt']]);
  $done = json_decode((string) @file_get_contents("$tmp/kaito-mock-finish.json"), true);
  check('finish forwards all case fields', $s === 200 && ($done['projectAddress'] ?? '') === '大阪府大阪市1-2-3' &&
    ($done['heating'] ?? '') === 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ' && ($done['folderId'] ?? '') === 'FOLDER' && ($done['files'][0]['id'] ?? '') === 'ID0');} finally {
  proc_terminate($api); proc_terminate($mock);
}
exit($failed ? 1 : 0);
