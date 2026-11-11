<?php
// 画面の共通部分(上部バー・スタイル・フッター)。JavaScript は使わない。
declare(strict_types=1);

function asset_data_uri(string $file, string $mime): string {
  return 'data:' . $mime . ';base64,' . base64_encode((string) file_get_contents(__DIR__ . '/assets/' . $file));
}

// カイトー商会ロゴの丸いマーク部分(assets/kaito.svg の最初の path)
function kaito_mark_path(): string {
  preg_match('/<path[^>]*\sd="([^"]+)"/', (string) file_get_contents(__DIR__ . '/assets/kaito.svg'), $m);
  return (string) preg_replace('/\s+/', ' ', $m[1] ?? '');
}

function page_start(string $title): void {
  $baqool = asset_data_uri('baqool.png', 'image/png');
  $kaito = asset_data_uri('kaito.svg', 'image/svg+xml');
  ?>
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title><?= h($title) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap">
<style>
:root{--text:#1d1d1f;--sub:#6e6e73;--bg:#fff;--accent:#00c8c8;--line:#d2d2d7;--soft:#f5f5f7;--error:#d70015;--bar:52px}
*{box-sizing:border-box}
html{scroll-padding-top:var(--bar)}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Noto Sans JP",sans-serif;font-size:16px;line-height:1.7;-webkit-font-smoothing:antialiased}
a{color:inherit}
.skip{position:absolute;left:-10000px;top:0}.skip:focus{left:12px;top:12px;background:#fff;padding:8px 12px;z-index:20}

/* 上部バー: 一番上では透明、下にスクロールすると白く不透明になる(CSS のスクロール連動アニメーション) */
.topbar{position:fixed;inset:0 0 auto;z-index:10;height:var(--bar);background:rgba(255,255,255,.92);
  -webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid rgba(0,0,0,.08)}
@supports (animation-timeline: scroll()){
  .topbar{animation:topbar linear both;animation-timeline:scroll(root);animation-range:0 64px}
  @keyframes topbar{from{background:rgba(255,255,255,0);border-bottom-color:rgba(0,0,0,0);-webkit-backdrop-filter:none;backdrop-filter:none}
    to{background:rgba(255,255,255,.92);border-bottom-color:rgba(0,0,0,.08)}}
}
.topbar-inner{max-width:1024px;height:100%;margin:auto;padding:0 22px;display:flex;align-items:center;justify-content:space-between}
.topbar img{display:block;width:auto}
.topbar .baqool{height:16px}.topbar .kaito{height:22px}

/* 見出し部分(Apple サポートのトップを参考に、中央にマーク、その下に「BAQOOL サポート」) */
.hero{padding:calc(var(--bar) + 64px) 22px 40px;text-align:center}
.mark{width:72px;height:72px;display:block;margin:0 auto 20px}
.hero h1{margin:0;display:flex;align-items:center;justify-content:center;gap:.35em;font-size:48px;font-weight:700;line-height:1.1;letter-spacing:.01em}
.hero h1 img{height:1em;width:auto;display:block;transform:translateY(.1em)}

.intro{max-width:800px;margin:0 auto;padding:24px 22px 40px;text-align:center}
.intro h2{font-size:32px;line-height:1.25;margin:0 0 16px;font-weight:700}
.intro p{margin:0;color:var(--sub);font-size:17px;text-wrap:pretty;word-break:auto-phrase}

main{padding-bottom:96px}
.card{max-width:720px;margin:0 auto;padding:40px;border:1px solid var(--line);border-radius:18px;background:#fff}
.card h3{font-size:20px;margin:0 0 24px;padding-bottom:12px;border-bottom:2px solid var(--accent);display:inline-block}
.card h3 + *{margin-top:0}
.section + .section{margin-top:40px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}
.field{margin-bottom:22px}
label,.label{display:block;font-weight:500;font-size:14px;margin-bottom:8px}
fieldset{border:0;padding:0;margin:0 0 22px;min-width:0}
legend{padding:0}
label.sub{font-weight:400;color:var(--sub);font-size:13px;margin:12px 0 6px}
legend + label.sub,.grid label.sub{margin-top:0}
.req{display:inline-block;margin-left:8px;padding:0 8px;border-radius:999px;background:rgba(0,200,200,.16);font-size:11px;font-weight:700;line-height:20px;vertical-align:1px}
input,select,textarea{font:inherit;color:inherit;width:100%;min-height:48px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fff}
textarea{min-height:120px;resize:vertical;line-height:1.6}
input[type=file]{padding:10px;font-size:14px}
input[type=file]::file-selector-button{font:inherit;border:0;border-radius:999px;background:var(--soft);padding:6px 14px;margin-right:12px;color:var(--text)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 4px rgba(0,200,200,.25)}
.hint{margin:8px 0 0;font-size:12px;color:var(--sub);line-height:1.6}
.hp{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
.errors{margin:0 0 28px;padding:16px 20px;border-radius:12px;background:#fff2f4;color:var(--error);font-size:14px}
.errors ul{margin:0;padding-left:1.2em}
.submit{margin-top:8px;text-align:center}
.button{font:inherit;font-weight:700;font-size:17px;color:var(--text);background:var(--accent);border:0;border-radius:999px;padding:14px 40px;min-height:50px;cursor:pointer;transition:filter .2s}
.button:hover{filter:brightness(.95)}
.button:focus-visible{outline:3px solid var(--text);outline-offset:3px}
.submit .hint{text-align:center}

.done{max-width:680px;margin:0 auto;text-align:center;padding:0 22px}
.done h2{font-size:32px;line-height:1.3;margin:0 0 16px}
.done p{color:var(--sub);margin:0 0 32px}
.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.file-box{border:1px dashed var(--line);border-radius:12px;padding:16px}
.file-add{display:inline-flex;align-items:center;gap:4px;margin:0;padding:8px 18px;border-radius:999px;background:var(--soft);font-size:14px;font-weight:500;cursor:pointer}
.file-add:hover{background:#ebebef}
#drawing-picker:focus-visible + .file-add{outline:3px solid var(--accent);outline-offset:2px}
.file-list{list-style:none;margin:12px 0 0;padding:0}
.file-list:empty{display:none}
.file-list li{display:flex;align-items:center;gap:12px;padding:10px 4px 10px 12px;border-top:1px solid var(--line);font-size:14px}
.file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-size{color:var(--sub);font-size:12px;white-space:nowrap}
.file-remove{flex:none;width:32px;height:32px;border:0;border-radius:50%;background:transparent;color:var(--sub);font-size:20px;line-height:1;cursor:pointer}
.file-remove:hover{background:var(--soft);color:var(--text)}
.file-remove:focus-visible{outline:3px solid var(--accent);outline-offset:1px}
.file-error{margin:8px 0 0;color:var(--error);font-size:13px;white-space:pre-line}
.file-error:empty{display:none}
.confirm{width:min(640px,calc(100% - 32px));max-height:calc(100% - 48px);border:0;border-radius:18px;padding:32px;color:var(--text)}
.confirm::backdrop{background:rgba(0,0,0,.45)}
.confirm h3{border:0;padding:0;margin:0 0 4px}
.confirm dl{display:grid;grid-template-columns:9em 1fr;margin:20px 0 0;font-size:14px}
.confirm dt,.confirm dd{margin:0;padding:10px 0;border-top:1px solid var(--line)}
.confirm dt{color:var(--sub)}
.confirm dd{white-space:pre-line;overflow-wrap:anywhere}
.confirm-actions{display:flex;gap:12px;justify-content:center;margin-top:24px}
.button.secondary{background:var(--soft)}
.button:disabled{opacity:.6;cursor:default}
@media(max-width:734px){.confirm{padding:24px 20px}.confirm dl{grid-template-columns:1fr}.confirm dd{border-top:0;padding-top:0}.confirm-actions{flex-direction:column-reverse}}
input.invalid,select.invalid{border-color:var(--error);box-shadow:0 0 0 4px rgba(215,0,21,.15)}
.delivery-date{margin:0;font-size:20px;font-weight:700}
.cf-turnstile{display:flex;justify-content:center;min-height:65px;margin-bottom:20px}
.link-button{display:inline-block;text-decoration:none;font-weight:700;color:var(--text);background:var(--accent);border-radius:999px;padding:12px 32px}

footer{border-top:1px solid var(--line);background:var(--soft);color:var(--sub);font-size:12px}
footer div{max-width:1024px;margin:auto;padding:20px 22px}

@media(max-width:734px){
  .hero{padding-top:calc(var(--bar) + 40px)}
  .mark{width:56px;height:56px}
  .hero h1{font-size:34px}
  .intro h2{font-size:26px}.intro p{font-size:15px}
  .card{border-radius:0;border-left:0;border-right:0;padding:28px 20px}
  .grid{grid-template-columns:1fr}
  .button{width:100%}
  .topbar .baqool{height:14px}.topbar .kaito{height:19px}
}
</style>
</head>
<body>
<a class="skip" href="#form">フォームへ移動</a>
<header class="topbar">
  <div class="topbar-inner">
    <img class="baqool" src="<?= $baqool ?>" alt="BAQOOL">
    <img class="kaito" src="<?= $kaito ?>" alt="株式会社カイトー商会">
  </div>
</header>
<section class="hero">
  <svg class="mark" viewBox="2 2 77 77" role="img" aria-label="カイトー商会"><path fill="#1B7FBE" d="<?= h(kaito_mark_path()) ?>"/></svg>
  <h1><img src="<?= $baqool ?>" alt="BAQOOL"><span>サポート</span></h1>
</section>
<?php
}

function page_end(): void {
  ?>
<footer><div>© BAQOOL / 株式会社カイトー商会</div></footer>
</body>
</html>
<?php
}
