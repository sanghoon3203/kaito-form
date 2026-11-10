<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/lib.php';
require dirname(__DIR__) . '/src/layout.php';

send_security_headers();
page_start('送信完了 | BAQOOL サポート');
?>
<main id="form">
  <section class="done">
    <h2>お問い合わせを受け付けました</h2>
    <p>ご提出いただき、誠にありがとうございます。<br>内容を確認の上、担当者よりご連絡させていただきます。</p>
    <a class="link-button" href="index.php">フォームへ戻る</a>
  </section>
</main>
<?php
page_end();
