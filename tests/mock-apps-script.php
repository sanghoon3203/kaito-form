<?php
// テスト用の Apps Script の代わり。受け取った内容をファイルに残し、決まった応答を返す。
$data = json_decode(file_get_contents('php://input'), true);
file_put_contents(sys_get_temp_dir() . '/kaito-mock-' . $data['action'] . '.json', json_encode($data, JSON_UNESCAPED_UNICODE));
header('Content-Type: application/json');
if (($data['secret'] ?? '') !== 'test-secret') exit(json_encode(['ok' => false]));
if ($data['action'] === 'prepare') {
  exit(json_encode(['ok' => true, 'folderId' => 'FOLDER', 'uploads' => array_map(function ($f, $i) {
    return ['id' => "ID$i", 'size' => $f['size'], 'name' => $f['name'],
      'url' => "http://127.0.0.1:8792/mock-upload.php?id=ID$i"];
  }, $data['files'], array_keys($data['files']))]));
}
exit(json_encode(['ok' => true]));
