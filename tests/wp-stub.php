<?php
// テスト用の WordPress の代わり。kaito-form.php が使う関数だけを用意し、[kaito_form] のある固定ページを開いた場面を再現する。
define('ABSPATH', __DIR__ . '/');
$GLOBALS['wp_actions'] = [];
function add_action($hook, $callback) { $GLOBALS['wp_actions'][$hook][] = $callback; }
function add_shortcode($tag, $callback) {}
function __return_empty_string() { return ''; }
function is_singular() { return true; }
function get_post() { return (object) ['post_content' => '<p>[kaito_form]</p>']; }
function has_shortcode($content, $tag) { return strpos($content, "[$tag") !== false; }
function nocache_headers() { header('Cache-Control: no-cache, must-revalidate, max-age=0'); }
function get_option($key, $default = false) { return json_decode((string) file_get_contents(getenv('KAITO_WP_OPTIONS')), true); }
function wp_upload_dir() { return ['basedir' => getenv('KAITO_WP_UPLOADS')]; }
function get_permalink() { return 'http://127.0.0.1:8796/support/'; }
function wp_unslash($value) { return is_array($value) ? array_map('wp_unslash', $value) : stripslashes($value); }
function add_query_arg($key, $value, $url) { return $url . (strpos($url, '?') === false ? '?' : '&') . $key . '=' . $value; }

// WordPress は、送信された値に \ を足す(wp_magic_quotes)
$_POST = array_map(function ($value) { return is_string($value) ? addslashes($value) : $value; }, $_POST);

require dirname(__DIR__) . '/kaito-form.php';
foreach ($GLOBALS['wp_actions']['template_redirect'] ?? [] as $callback) $callback();
echo 'THEME PAGE'; // フォームのページでは、ここまで来ない
