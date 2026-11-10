<?php
// テスト用の Google ドライブ送信先の代わり。受け取ったファイルの中身を残す。
$id = preg_replace('/[^A-Za-z0-9]/', '', (string) ($_GET['id'] ?? ''));
file_put_contents(sys_get_temp_dir() . "/kaito-upload-$id.bin", file_get_contents('php://input'));
http_response_code(200);
echo '{"id":"' . $id . '"}';
