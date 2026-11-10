<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/lib.php';
require dirname(__DIR__) . '/src/layout.php';

send_security_headers();
header('Cache-Control: no-store');

$errors = [];
$values = [];
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
  if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > max_total_size()) {
    // 上限を超えると PHP は入力を捨てるので、ここで知らせる
    $errors = ['添付ファイルの合計が大きすぎます。合計' . format_mb(max_total_size()) . '以内にしてください。'];
  } else {
    try {
      $errors = handle_post($_POST, $_FILES['drawing'] ?? null, (string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    } catch (Throwable $e) {
      error_log('kaito-form: ' . $e->getMessage());
      $errors = ['受付処理を完了できませんでした。重複送信を避けるため、もう一度送る前に担当者へご確認ください。'];
    }
  }
  if (!$errors) {
    header('Location: complete.php', true, 303);
    exit;
  }
  http_response_code(422);
  $values = array_map(function ($v) { return is_string($v) ? $v : ''; }, $_POST);
}
$v = function (string $name) use ($values): string { return h($values[$name] ?? ''); };

page_start('お問い合わせ | BAQOOL サポート');
?>
<section class="intro">
  <h2>お問い合わせ</h2>
  <p>ご不明な点やご相談がございましたら、下記フォームよりお気軽にお問い合わせください。<br>内容を確認の上、担当者よりご連絡させていただきます。</p>
</section>
<main id="form">
  <form class="card" method="post" action="" enctype="multipart/form-data">
    <?php if ($errors): ?>
      <div class="errors" role="alert">
        <ul><?php foreach ($errors as $error): ?><li><?= h($error) ?></li><?php endforeach; ?></ul>
        <?php if ($values): ?><p class="hint">お手数ですが、図面ファイルはもう一度選択してください。</p><?php endif; ?>
      </div>
    <?php endif; ?>
    <input type="hidden" name="token" value="<?= h(issue_form_token()) ?>">
    <div class="hp" aria-hidden="true"><label for="website">Website</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>

    <div class="section">
      <h3>ご提出者</h3>
      <div class="grid">
        <div class="field"><label for="company">会社名<span class="req">必須</span></label><input id="company" name="company" autocomplete="organization" maxlength="100" required value="<?= $v('company') ?>"></div>
        <div class="field"><label for="branch">支店名</label><input id="branch" name="branch" maxlength="100" value="<?= $v('branch') ?>"></div>
      </div>
      <div class="field"><label for="contact">ご担当者名<span class="req">必須</span></label><input id="contact" name="contact" autocomplete="name" maxlength="100" required value="<?= $v('contact') ?>"></div>
      <div class="field"><label for="email">メールアドレス<span class="req">必須</span></label><input id="email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required pattern="[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+" title="半角英数字でご入力ください" value="<?= $v('email') ?>"></div>
    </div>

    <div class="section">
      <h3>案件情報</h3>
      <div class="field"><label for="projectName">案件名<span class="req">必須</span></label><input id="projectName" name="projectName" maxlength="200" required aria-describedby="projectName-hint" value="<?= $v('projectName') ?>"><p class="hint" id="projectName-hint">例：〇〇様邸 新築工事</p></div>
      <div class="field"><label for="projectAddress">案件住所<span class="req">必須</span></label><input id="projectAddress" name="projectAddress" maxlength="200" required value="<?= $v('projectAddress') ?>"></div>
      <div class="grid">
        <div class="field"><label for="heating">床下暖房種別</label><select id="heating" name="heating">
          <option value="">未定</option>
          <?php foreach (['放熱器' => '放熱器', 'AC' => 'AC', 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ' => 'ファンコンベクター'] as $value => $label): ?>
            <option value="<?= h($value) ?>"<?= ($values['heating'] ?? '') === $value ? ' selected' : '' ?>><?= h($label) ?></option>
          <?php endforeach; ?>
        </select></div>
        <div class="field"><label for="start">着工予定日</label><input id="start" name="start" type="date" aria-describedby="start-hint" value="<?= $v('start') ?>"><p class="hint" id="start-hint">予定日が未定の場合は、空欄のままご送信いただけます。</p></div>
      </div>
      <div class="field"><label for="note">備考</label><textarea id="note" name="note" maxlength="1000"><?= $v('note') ?></textarea></div>
    </div>

    <div class="section">
      <h3>図面ファイル</h3>
      <div class="field"><label for="drawing">図面ファイル<span class="req">必須</span></label><input id="drawing" name="drawing[]" type="file" accept="application/pdf,.pdf,.jww" multiple required aria-describedby="drawing-hint"><p class="hint" id="drawing-hint">PDFとJWWをそれぞれ10ファイルまで、1ファイル<?= h(format_mb(max_file_size())) ?>まで、合計<?= h(format_mb(max_total_size())) ?>まで添付できます。</p></div>
    </div>

    <div class="submit">
      <button class="button" type="submit">内容を送信する</button>
      <p class="hint">ファイルの大きさによっては、送信に時間がかかる場合がございます。<br>画面が切り替わるまで、送信ボタンは一度だけ押してお待ちください。</p>
    </div>
  </form>
</main>
<?php
page_end();
