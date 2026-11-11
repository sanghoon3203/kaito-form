<?php
// 受付完了のページ本体。呼び出し側が $kaitoFormUrl(フォームへ戻るアドレス)を用意してから読み込む。
declare(strict_types=1);

namespace KaitoForm;

if (!function_exists(__NAMESPACE__ . '\\page_start')) exit; // このファイルを直接開いても何もしない

send_security_headers();
page_start('送信完了 | BAQOOL サポート');
?>
<main id="form">
  <section class="done">
    <h2>お問い合わせを受け付けました</h2>
    <p>ご提出いただき、誠にありがとうございます。<br>内容を確認の上、担当者よりご連絡させていただきます。</p>
    <a class="link-button" href="<?= h($kaitoFormUrl) ?>">フォームへ戻る</a>
  </section>
</main>
<?php
page_end();
