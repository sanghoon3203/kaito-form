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
  <p>物件へのBAQOOLの導入をご検討の方は、図面とご連絡先を添えて、<br>下記フォームよりお問い合わせください。<br>内容を確認の上、担当者よりご連絡させていただきます。</p>
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
        <div class="field"><label for="branch">支店名<span class="req">必須</span></label><input id="branch" name="branch" maxlength="100" required placeholder="例：新潟支店" aria-describedby="branch-hint" value="<?= $v('branch') ?>"><p class="hint" id="branch-hint">施工を担当される支店名をご入力ください。</p></div>
      </div>
      <div class="field"><label for="contact">ご担当者名<span class="req">必須</span></label><input id="contact" name="contact" autocomplete="name" maxlength="100" required value="<?= $v('contact') ?>"></div>
      <div class="field"><label for="email">メールアドレス<span class="req">必須</span></label><input id="email" name="email" type="email" inputmode="email" autocomplete="email" maxlength="254" required pattern="[\x21-\x7E]+@[\x21-\x7E]+\.[\x21-\x7E]+" title="半角英数字でご入力ください" value="<?= $v('email') ?>"></div>
    </div>

    <div class="section">
      <h3>案件情報</h3>
      <fieldset class="field">
        <legend class="label">案件名（施主様のお名前）<span class="req">必須</span></legend>
        <div class="grid">
          <div><label class="sub" for="projectSei">姓</label><input id="projectSei" name="projectSei" maxlength="50" required placeholder="例：山田" value="<?= $v('projectSei') ?>"></div>
          <div><label class="sub" for="projectMei">名</label><input id="projectMei" name="projectMei" maxlength="50" required placeholder="例：太郎" value="<?= $v('projectMei') ?>"></div>
        </div>
      </fieldset>
      <fieldset class="field">
        <legend class="label">案件住所<span class="req">必須</span></legend>
        <label class="sub" for="pref">都道府県</label>
        <select id="pref" name="pref" required autocomplete="address-level1">
          <option value="">選択してください</option>
          <?php foreach (PREFECTURES as $pref): ?><option<?= ($values['pref'] ?? '') === $pref ? ' selected' : '' ?>><?= h($pref) ?></option><?php endforeach; ?>
        </select>
        <label class="sub" for="city">市区町村</label>
        <input id="city" name="city" maxlength="100" required autocomplete="address-level2" placeholder="例：横浜市中区" value="<?= $v('city') ?>">
        <label class="sub" for="street">丁目番地・建物名・部屋番号</label>
        <input id="street" name="street" maxlength="200" required autocomplete="address-line1" placeholder="例：本町1-2-3 〇〇マンション101" value="<?= $v('street') ?>">
      </fieldset>
      <div class="field"><label for="heating">床下暖房種別<span class="req">必須</span></label><select id="heating" name="heating" required>
        <option value="">選択してください</option>
        <?php foreach (['放熱器' => '放熱器', 'AC' => 'AC', 'ﾌｧﾝｺﾝﾍﾞｸﾀｰ' => 'ファンコンベクター', '未定' => '未定'] as $value => $label): ?>
          <option value="<?= h($value) ?>"<?= ($values['heating'] ?? '') === $value ? ' selected' : '' ?>><?= h($label) ?></option>
        <?php endforeach; ?>
      </select></div>
      <div class="grid">
        <div class="field"><label for="start">着工予定日<span class="req">必須</span></label><input id="start" name="start" type="date" required aria-describedby="start-hint" value="<?= $v('start') ?>"><p class="hint" id="start-hint">おおよその日付で構いません。</p></div>
        <div class="field"><label for="finish">完工予定日<span class="req">必須</span></label><input id="finish" name="finish" type="date" required aria-describedby="finish-hint" value="<?= $v('finish') ?>"><p class="hint" id="finish-hint">おおよその日付で構いません。</p></div>
      </div>
      <div class="grid">
        <div class="field"><label for="deadline">図面の希望納期<span class="req">必須</span></label><input id="deadline" name="deadline" type="date" required aria-describedby="deadline-hint" value="<?= $v('deadline') ?>"><p class="hint" id="deadline-hint">お申し込み日を除いて4営業日後となります。</p></div>
        <div class="field"><label for="rush">納期の短縮<span class="req">必須</span></label><select id="rush" name="rush" required aria-describedby="rush-hint">
          <?php foreach (array_keys(RUSH_OPTIONS) as $rush): ?><option<?= ($values['rush'] ?? '') === $rush ? ' selected' : '' ?>><?= h($rush) ?></option><?php endforeach; ?>
        </select><p class="hint" id="rush-hint">納期の短縮には追加料金がかかります。</p></div>
      </div>
      <?php
      // 短縮の選択肢ごとの納品予定日。いまの時刻の分と、今日の営業時間を過ぎた後の分。
      // 画面を開いたまま営業時間を過ぎたら、JavaScript が後者に切り替える(送信時には PHP が計算し直す)
      $now = now_tokyo();
      $datesAt = function (DateTimeImmutable $at) {
        $out = [];
        foreach (array_keys(RUSH_OPTIONS) as $rush) $out[$rush] = delivery_date($rush, '', $at);
        return $out;
      };
      $closesAt = $now->modify(BUSINESS_CLOSE)->modify('+1 minute');
      $lateIn = is_business_day($now) && $now < $closesAt ? ($closesAt->getTimestamp() - $now->getTimestamp()) * 1000 : '';
      ?>
      <div class="field delivery" id="delivery" data-dates="<?= h(json_encode($datesAt($now), JSON_UNESCAPED_UNICODE)) ?>"
        data-late-dates="<?= h(json_encode($datesAt($now->setTime(23, 59)), JSON_UNESCAPED_UNICODE)) ?>" data-late-in="<?= h((string) $lateIn) ?>">
        <span class="label">納品予定日（目安）</span>
        <p class="delivery-date"><output id="delivery-date" for="deadline rush"><?= h(jp_date(delivery_date($values['rush'] ?? '', $values['deadline'] ?? ''))) ?></output></p>
        <p class="hint">受付時間（平日 8:30〜17:30）を過ぎたお申し込みは、翌営業日の受付として計算します。</p>
      </div>
      <div class="field"><label for="note">備考</label><textarea id="note" name="note" maxlength="1000"><?= $v('note') ?></textarea></div>
    </div>

    <div class="section">
      <h3>図面ファイル</h3>
      <div class="field">
        <label for="drawing" id="drawing-label">図面ファイル<span class="req">必須</span></label>
        <?php /* 送信されるのはこの入力欄。JavaScript が動くときは隠し、下の「ファイルを追加」と一覧で選んだファイルをここに入れる */ ?>
        <input id="drawing" name="drawing[]" type="file" accept="application/pdf,.pdf,.jww" multiple required aria-describedby="drawing-hint"
          data-max-size="<?= max_file_size() ?>" data-max-total="<?= max_total_size() ?>" data-max-files="<?= MAX_FILES ?>">
        <div class="file-box" id="drawing-box" hidden>
          <input class="visually-hidden" id="drawing-picker" type="file" accept="application/pdf,.pdf,.jww" multiple aria-describedby="drawing-hint">
          <label class="file-add" for="drawing-picker">＋ ファイルを追加</label>
          <ul class="file-list" id="drawing-list" aria-label="添付するファイル"></ul>
          <p class="file-error" id="drawing-error" role="alert"></p>
        </div>
        <p class="hint" id="drawing-hint">PDF・JWWファイルを合計<?= MAX_FILES ?>個まで添付できます（1ファイル<?= h(format_mb(max_file_size())) ?>まで、合計<?= h(format_mb(max_total_size())) ?>まで）。</p>
      </div>
    </div>

    <div class="submit">
      <div class="cf-turnstile" data-sitekey="<?= h(env()['TURNSTILE_SITE_KEY'] ?? '') ?>" data-language="ja"></div>
      <noscript><p class="errors">送信前の確認のため、ブラウザの JavaScript を有効にしてください。</p></noscript>
      <button class="button" type="submit">内容を送信する</button>
      <p class="hint">ファイルの大きさによっては、送信に時間がかかる場合がございます。<br>画面が切り替わるまで、送信ボタンは一度だけ押してお待ちください。</p>
    </div>
    <dialog class="confirm" id="confirm" aria-labelledby="confirm-title">
      <h3 id="confirm-title">入力内容のご確認</h3>
      <p class="hint">以下の内容で送信します。よろしければ「この内容で送信する」を押してください。</p>
      <dl id="confirm-list"></dl>
      <div class="confirm-actions">
        <button class="button secondary" type="button" id="confirm-back">修正する</button>
        <button class="button" type="button" id="confirm-send">この内容で送信する</button>
      </div>
    </dialog>
  </form>
</main>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<script nonce="<?= h(csp_nonce()) ?>">
// 図面ファイルを1つずつ追加でき、一覧の × で外せるようにする。
// JavaScript が動かないブラウザでは、元のファイル選択欄がそのまま使われる。
(() => {
  const real = document.getElementById('drawing');
  const picker = document.getElementById('drawing-picker');
  const list = document.getElementById('drawing-list');
  const error = document.getElementById('drawing-error');
  if (!real || !picker || typeof DataTransfer !== 'function') return;
  const maxSize = Number(real.dataset.maxSize);
  const maxTotal = Number(real.dataset.maxTotal);
  const maxFiles = Number(real.dataset.maxFiles);
  let files = [];

  document.getElementById('drawing-box').hidden = false;
  real.hidden = true;
  real.required = false;
  document.getElementById('drawing-label').htmlFor = 'drawing-picker';

  const mb = bytes => (bytes / 1024 / 1024 >= 1 ? (bytes / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(bytes / 1024)) + 'KB');
  const type = file => (file.name.match(/\.(pdf|jww)$/i) || [])[1]?.toLowerCase();

  function render() {
    const dt = new DataTransfer();
    files.forEach(file => dt.items.add(file));
    real.files = dt.files; // 送信用の入力欄に反映する
    list.replaceChildren(...files.map((file, i) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = file.name;
      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = mb(file.size);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'file-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', file.name + ' を一覧から外す');
      remove.addEventListener('click', () => {
        files.splice(i, 1);
        error.textContent = '';
        render();
        (list.querySelectorAll('.file-remove')[Math.min(i, files.length - 1)] || picker).focus();
      });
      item.append(name, size, remove);
      return item;
    }));
  }

  picker.addEventListener('change', () => {
    const problems = [];
    for (const file of picker.files) {
      const kind = type(file);
      if (!kind) { problems.push(file.name + '：PDFまたはJWWファイルを選んでください。'); continue; }
      if (file.size > maxSize) { problems.push(file.name + '：1ファイル' + mb(maxSize) + 'までです。'); continue; }
      if (files.some(f => f.name === file.name && f.size === file.size)) { problems.push(file.name + '：すでに追加されています。'); continue; }
      if (files.length >= maxFiles) { problems.push(file.name + '：ファイルは合計' + maxFiles + '個までです。'); continue; }
      if (files.reduce((sum, f) => sum + f.size, 0) + file.size > maxTotal) { problems.push(file.name + '：合計' + mb(maxTotal) + 'を超えるため追加できません。'); continue; }
      files.push(file);
    }
    picker.value = ''; // 同じファイルをもう一度選んでも change が起きるようにする
    error.textContent = problems.join('\n');
    render();
  });

  real.form.addEventListener('submit', event => {
    if (!files.length) {
      event.preventDefault();
      error.textContent = '図面ファイルを追加してください。';
      picker.focus();
    }
  });
})();

// 納品予定日(目安)を、納期の短縮と希望納期に合わせて表示し直す。日付は PHP が営業日で計算したものを使う。
(() => {
  const box = document.getElementById('delivery');
  if (!box) return;
  const early = JSON.parse(box.dataset.dates);
  const late = JSON.parse(box.dataset.lateDates);
  const lateAt = box.dataset.lateIn === '' ? null : Date.now() + Number(box.dataset.lateIn); // 今日の営業時間が終わる時刻
  const form = box.closest('form');
  const out = document.getElementById('delivery-date');
  const show = () => {
    const rush = form.elements.rush.value;
    const wish = form.elements.deadline.value;
    const dates = lateAt !== null && Date.now() >= lateAt ? late : early;
    let date = dates[rush] || dates['希望しない'];
    if (rush === '希望しない' && wish > date) date = wish; // 短縮なしで、希望納期のほうが後ならそちら
    const [y, m, d] = date.split('-').map(Number);
    out.textContent = date.replaceAll('-', '/') + '（' + '日月火水木金土'[new Date(y, m - 1, d).getDay()] + '）';
  };
  form.elements.rush.addEventListener('change', show);
  form.elements.deadline.addEventListener('change', show);
  form.addEventListener('submit', show); // 確認画面を出す直前にも計算し直す
  setInterval(show, 30000);
  show();
})();

// 送信前に、入力内容を確認する画面を出す。JavaScript が動かないブラウザでは、そのまま送信される。
(() => {
  const dialog = document.getElementById('confirm');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const form = dialog.closest('form');
  const list = document.getElementById('confirm-list');
  const send = document.getElementById('confirm-send');
  const val = name => (form.elements[name]?.value || '').trim();
  const date = name => val(name).replaceAll('-', '/');
  const heating = () => form.elements.heating.selectedOptions[0]?.textContent || '';
  let confirmed = false;

  form.addEventListener('submit', event => {
    if (event.defaultPrevented || confirmed) return;
    event.preventDefault();
    const rows = [
      ['会社名', val('company')], ['支店名', val('branch')], ['ご担当者名', val('contact')], ['メールアドレス', val('email')],
      ['案件名', val('projectSei') + '　' + val('projectMei')], ['案件住所', val('pref') + val('city') + val('street')],
      ['床下暖房種別', heating()], ['着工予定日', date('start')], ['完工予定日', date('finish')],
      ['図面の希望納期', date('deadline')], ['納期の短縮', val('rush')],
      ['納品予定日（目安）', document.getElementById('delivery-date').textContent], ['備考', val('note') || 'なし'],
      ['図面ファイル', [...document.getElementById('drawing').files].map(f => f.name).join('\n')],
    ];
    list.replaceChildren(...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }));
    dialog.showModal();
  });
  document.getElementById('confirm-back').addEventListener('click', () => dialog.close());
  send.addEventListener('click', () => {
    confirmed = true;
    send.disabled = true; // 二度押しを防ぐ
    send.textContent = '送信しています…';
    form.requestSubmit();
  });
})();
</script>
<?php
page_end();
