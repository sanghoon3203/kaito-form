<?php
// WordPress を使わずに置くときの入口。フォームの本体は src/form-page.php
declare(strict_types=1);
require dirname(__DIR__) . '/src/lib.php';
require dirname(__DIR__) . '/src/layout.php';

$kaitoPost = $_POST;
$kaitoUpload = $_FILES['drawing'] ?? null;
$kaitoIp = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
$kaitoCompleteUrl = 'complete.php';
require dirname(__DIR__) . '/src/form-page.php';
