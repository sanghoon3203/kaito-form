<?php
// テスト用の Apps Script の代わり。受け取った内容をファイルに残し、決まった応答を返す。
$data = json_decode(file_get_contents('php://input'), true);
file_put_contents(sys_get_temp_dir() . '/kaito-mock-' . $data['action'] . '.json', json_encode($data, JSON_UNESCAPED_UNICODE));
header('Content-Type: application/json');
if (($data['secret'] ?? '') !== 'test-secret') exit(json_encode(['ok' => false]));
if ($data['action'] === 'prepare') {
  exit(json_encode(['ok' => true, 'folderId' => 'FOLDER', 'uploads' => array_map(function ($f, $i) {
    return ['id' => "ID$i", 'size' => $f['size'], 'name' => $f['name'], 'type' => 'application/pdf',
      'url' => 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'];
  }, $data['files'], array_keys($data['files']))]));
}
exit(json_encode(['ok' => true]));
