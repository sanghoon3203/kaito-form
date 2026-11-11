<?php
/**
 * Plugin Name: Kaito Form（BAQOOL サポート お問い合わせ）
 * Description: 図面と案件情報を受け付けるフォーム。固定ページの本文に [kaito_form] と書くと、そのページがフォームになります。
 * Version: 1.0.0
 * Requires PHP: 7.4
 * Author: BAQOOL / 株式会社カイトー商会
 */

// WordPress に組み込むための入口。フォームの本体は src/ にあり、WordPress なしでも public/ から動く。
// [kaito_form] のあるページは、テーマを通さずにフォームの画面をそのまま出す。
// (テーマの CSS・JavaScript と混ざらず、スクリプトを制限するセキュリティ設定もそのまま使えるため)

if (!defined('ABSPATH')) exit;

const KAITO_FORM_OPTION = 'kaito_form_settings';

/** 設定項目 => [画面の表示名, 説明, 秘密の値か] */
function kaito_form_fields(): array {
  return [
    'APPS_SCRIPT_URL' => ['Apps Script の URL', 'ウェブアプリの URL（https://script.google.com/macros/s/…/exec）', false],
    'SHARED_SECRET' => ['共有シークレット', 'Apps Script の Script Properties「SHARED_SECRET」と同じ値', true],
    'TURNSTILE_SITE_KEY' => ['Turnstile サイトキー', 'Cloudflare Turnstile のサイトキー', false],
    'TURNSTILE_SECRET' => ['Turnstile シークレットキー', 'Cloudflare Turnstile のシークレットキー', true],
  ];
}

// テーマがそのまま本文を出す場面(検索結果など)で、[kaito_form] という文字が見えないようにする
add_shortcode('kaito_form', '__return_empty_string');

add_action('template_redirect', function () {
  if (!is_singular()) return;
  $post = get_post();
  if (!$post || !has_shortcode((string) $post->post_content, 'kaito_form')) return;

  // このページはキャッシュさせない(1回だけ使えるトークンと、その時刻の納品予定日が入っているため)
  if (!defined('DONOTCACHEPAGE')) define('DONOTCACHEPAGE', true);
  nocache_headers();

  $settings = array_filter(array_map('strval', (array) get_option(KAITO_FORM_OPTION, [])), 'strlen');
  $uploads = wp_upload_dir(null, false);
  $GLOBALS['kaito_env'] = $settings + ['DATA_DIR' => $uploads['basedir'] . '/kaito-form'];

  require_once __DIR__ . '/src/lib.php';
  require_once __DIR__ . '/src/layout.php';

  $url = (string) get_permalink($post);
  if (isset($_GET['kaito_done'])) {
    $kaitoFormUrl = $url;
    require __DIR__ . '/src/complete-page.php';
    exit;
  }
  $kaitoPost = wp_unslash($_POST); // WordPress は送信された値に \ を足すので、外してから渡す
  $kaitoUpload = $_FILES['drawing'] ?? null;
  $kaitoIp = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
  $kaitoCompleteUrl = add_query_arg('kaito_done', '1', $url);
  require __DIR__ . '/src/form-page.php';
  exit;
});

// ---- 管理画面: 設定 > Kaito Form ----

add_action('admin_menu', function () {
  add_options_page('Kaito Form', 'Kaito Form', 'manage_options', 'kaito-form', 'kaito_form_settings_page');
});

add_action('admin_init', function () {
  register_setting('kaito_form', KAITO_FORM_OPTION, ['type' => 'array', 'sanitize_callback' => 'kaito_form_sanitize']);
});

function kaito_form_sanitize($input): array {
  $saved = (array) get_option(KAITO_FORM_OPTION, []);
  $out = [];
  foreach (kaito_form_fields() as $key => [, , $secret]) {
    $value = trim((string) wp_unslash($input[$key] ?? ''));
    // 秘密の値は画面に出さないので、空欄で保存されたら前の値を残す
    $out[$key] = ($secret && $value === '') ? (string) ($saved[$key] ?? '') : sanitize_text_field($value);
  }
  if ($out['APPS_SCRIPT_URL'] !== '' && strpos($out['APPS_SCRIPT_URL'], 'https://') !== 0) {
    add_settings_error(KAITO_FORM_OPTION, 'url', 'Apps Script の URL は https:// で始まる必要があります。');
    $out['APPS_SCRIPT_URL'] = (string) ($saved['APPS_SCRIPT_URL'] ?? '');
  }
  return $out;
}

function kaito_form_settings_page(): void {
  if (!current_user_can('manage_options')) return;
  $saved = (array) get_option(KAITO_FORM_OPTION, []);
  ?>
  <div class="wrap">
    <h1>Kaito Form</h1>
    <p>固定ページの本文に <code>[kaito_form]</code> と書くと、そのページがお問い合わせフォームになります。</p>
    <form method="post" action="options.php">
      <?php settings_fields('kaito_form'); ?>
      <table class="form-table" role="presentation">
        <?php foreach (kaito_form_fields() as $key => [$label, $help, $secret]): ?>
          <tr>
            <th scope="row"><label for="kaito-<?php echo esc_attr($key); ?>"><?php echo esc_html($label); ?></label></th>
            <td>
              <input class="regular-text" id="kaito-<?php echo esc_attr($key); ?>" autocomplete="off"
                name="<?php echo esc_attr(KAITO_FORM_OPTION . '[' . $key . ']'); ?>"
                type="<?php echo $secret ? 'password' : 'text'; ?>"
                value="<?php echo $secret ? '' : esc_attr((string) ($saved[$key] ?? '')); ?>"
                placeholder="<?php echo ($secret && !empty($saved[$key])) ? '（設定済み。変えるときだけ入力）' : ''; ?>">
              <p class="description"><?php echo esc_html($help); ?></p>
            </td>
          </tr>
        <?php endforeach; ?>
      </table>
      <?php submit_button(); ?>
    </form>
    <h2>サーバーの設定</h2>
    <p>
      添付できるのは 1ファイル 8MB・合計 80MB までです。php.ini の値がこれより小さいと、フォームの上限もその値まで下がります。<br>
      現在の値: upload_max_filesize = <code><?php echo esc_html((string) ini_get('upload_max_filesize')); ?></code>、
      post_max_size = <code><?php echo esc_html((string) ini_get('post_max_size')); ?></code>、
      max_file_uploads = <code><?php echo esc_html((string) ini_get('max_file_uploads')); ?></code>
    </p>
  </div>
  <?php
}
