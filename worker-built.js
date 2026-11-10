const LOGO = "data:image/png;base64,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";
// Build with build.py. Configure the secrets and Turnstile keys in Cloudflare.
const HTML = "<!doctype html>\n<html lang=\"ja\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n  <meta name=\"robots\" content=\"noindex, nofollow\">\n  <title>図面・工事予定のご提出 | 株式会社カイトー商会</title>\n  <style>\n    :root{font-family:Manrope,\"Noto Sans JP\",sans-serif;color:#171717;background:#f5f5f3;font-size:16px}*{box-sizing:border-box}body{margin:0}a.skip{position:absolute;top:-100px;left:12px;background:#fff;padding:12px;z-index:10}a.skip:focus{top:12px}header{background:#fff;border-bottom:1px solid #e4e4e4}.header-inner{max-width:1080px;margin:auto;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:24px}.logo{width:240px;max-width:62%;height:auto}.header-label{font-size:12px;color:#666;letter-spacing:.06em}main{max-width:1080px;margin:auto;padding:64px 24px 80px}.intro{max-width:680px;margin-bottom:40px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#0058a8;font-weight:700;margin:0 0 16px}.intro h1{font-size:36px;line-height:1.3;letter-spacing:.03em;margin:0 0 16px;text-wrap:balance}.intro p{color:#555;line-height:1.8;margin:0;text-wrap:pretty}.layout{display:grid;grid-template-columns:minmax(0,1fr) 248px;gap:32px;align-items:start}.panel{background:white;border:1px solid #e5e5e5;padding:40px}.section-head{display:flex;align-items:baseline;gap:12px;margin-bottom:24px}.section-head h2{font-size:20px;margin:0}.section-head span{font-size:12px;color:#777}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.field{margin-bottom:24px}.field label{display:block;font-weight:700;font-size:14px;margin-bottom:8px}.required{font-size:12px;color:#0058a8;margin-left:8px}.hint{font-size:12px;color:#666;line-height:1.6;margin:8px 0 0}input{font:inherit;color:inherit;width:100%;border:1px solid #c9c9c9;border-radius:4px;padding:12px;background:#fff;min-height:48px}input:focus,button:focus-visible{outline:3px solid #89bce7;outline-offset:2px}input[type=file]{padding:12px;font-size:14px}input[type=file]::file-selector-button{border:0;background:#eee;padding:8px 12px;border-radius:4px;margin-right:12px;color:#222}hr{border:0;border-top:1px solid #ececec;margin:32px 0}.notice{font-size:14px;line-height:1.8;color:#555}.notice h2{font-size:14px;color:#171717;margin:0 0 12px}.notice p{margin:0 0 24px}.notice strong{color:#0058a8}.button{font:inherit;font-weight:700;background:#0058a8;color:#fff;border:0;border-radius:4px;padding:12px 24px;min-height:48px;cursor:pointer;transition:background .3s cubic-bezier(.22,1,.36,1)}.button:hover{background:#00447f}.button:active{transform:translateY(1px)}.button:disabled{background:#aaa;cursor:not-allowed}.status{font-size:14px;line-height:1.7;margin:16px 0 0;white-space:pre-wrap}.status.error{color:#a32727}.status.success{color:#12673a}.foot{max-width:1080px;margin:auto;padding:24px;color:#777;font-size:12px;border-top:1px solid #ddd}.cf-turnstile{margin-bottom:16px}@media(max-width:720px){main{padding:40px 16px 64px}.header-inner{padding:12px 16px}.logo{width:200px}.header-label{font-size:12px}.intro h1{font-size:30px}.layout{grid-template-columns:1fr;gap:24px}.panel{padding:24px}.grid{grid-template-columns:1fr;gap:0}.notice{order:-1}.notice p{margin:0}.notice h2{margin-bottom:8px}}\n  </style>\n</head>\n<body>\n<a class=\"skip\" href=\"#main\">本文へ移動</a>\n<header><div class=\"header-inner\"><img class=\"logo\" src=\"/logo.png\" alt=\"株式会社カイトー商会\"><span class=\"header-label\">図面・工事予定 ご提出フォーム</span></div></header>\n<main id=\"main\">\n  <div class=\"intro\"><p class=\"eyebrow\">お申し込み受付</p><h1>お申し込みフォーム</h1></div>\n  <div class=\"layout\">\n    <form class=\"panel\" id=\"submission\" novalidate>\n      <div class=\"section-head\"><h2>ご提出内容</h2><span>必須項目をご入力ください</span></div>\n      <div class=\"grid\"><div class=\"field\"><label for=\"company\">会社名<span class=\"required\">必須</span></label><input id=\"company\" name=\"company\" autocomplete=\"organization\" maxlength=\"100\" required></div><div class=\"field\"><label for=\"contact\">ご担当者名<span class=\"required\">必須</span></label><input id=\"contact\" name=\"contact\" autocomplete=\"name\" maxlength=\"100\" required></div></div>\n      <div class=\"field\"><label for=\"email\">メールアドレス<span class=\"required\">必須</span></label><input id=\"email\" name=\"email\" type=\"email\" autocomplete=\"email\" maxlength=\"254\" required></div>\n      <div class=\"grid\"><div class=\"field\"><label for=\"start\">着工予定日</label><input id=\"start\" name=\"start\" type=\"date\"></div><div class=\"field\"><label for=\"finish\">工事完了予定日</label><input id=\"finish\" name=\"finish\" type=\"date\"></div></div>\n      <hr>\n      <div class=\"field\"><label for=\"drawing\">図面ファイル<span class=\"required\">必須</span></label><input id=\"drawing\" name=\"drawing\" type=\"file\" accept=\"application/pdf,.pdf,.jww\" multiple required aria-describedby=\"drawing-hint\"><p class=\"hint\" id=\"drawing-hint\">PDFとJWWをそれぞれ10ファイルまで添付できます。</p></div>\n      <div id=\"turnstile\"></div><button class=\"button\" id=\"submit\" type=\"submit\">内容を送信する</button><p id=\"status\" class=\"status\" role=\"status\" aria-live=\"polite\"></p>\n    </form>\n    <aside class=\"notice\"><h2>予定日が未定の場合</h2><p>空欄のまま送信できます。</p></aside>\n  </div>\n</main>\n<footer class=\"foot\">© 株式会社カイトー商会</footer>\n<script>\nconst form = document.querySelector('#submission');\nconst status = document.querySelector('#status');\nconst submit = document.querySelector('#submit');\nlet pending;\nform.addEventListener('change', () => { pending = undefined; });\n\nasync function loadTurnstile() {\n  const response = await fetch('/api/config');\n  if (!response.ok) return;\n  const { siteKey } = await response.json();\n  if (!siteKey) return;\n  const script = document.createElement('script');\n  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';\n  script.async = true;\n  script.onload = () => turnstile.render('#turnstile', { sitekey: siteKey });\n  document.head.appendChild(script);\n}\nloadTurnstile().catch(() => {});\n\nasync function requestJson(path, options) {\n  const response = await fetch(path, options);\n  const data = await response.json();\n  if (!response.ok) throw new Error(data.error || '送信できませんでした。');\n  return data;\n}\n\nfunction post(path, body) {\n  return requestJson(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });\n}\n\nfunction uploadChunk(key, range, body) {\n  return requestJson('/api/upload', { method: 'PUT', headers: { 'X-Upload-Key': key, 'Content-Range': range }, body });\n}\n\nform.addEventListener('submit', async event => {\n  event.preventDefault();\n  if (!form.reportValidity()) return;\n  status.className = 'status';\n  submit.disabled = true;\n  const inputs = [...form.elements].filter(element => element.tagName === 'INPUT' && element.type !== 'hidden');\n  const values = new FormData(form);\n  inputs.forEach(element => { element.disabled = true; });\n  try {\n    const files = values.getAll('drawing');\n    if (files.some(file => !/\\.(pdf|jww)$/i.test(file.name) || !file.size) ||\n        files.filter(file => /\\.pdf$/i.test(file.name)).length > 10 ||\n        files.filter(file => /\\.jww$/i.test(file.name)).length > 10) {\n      throw new Error('PDFとJWWは、それぞれ10ファイルまで添付できます。');\n    }\n    if (values.get('start') && values.get('finish') && values.get('finish') < values.get('start')) {\n      throw new Error('工事完了予定日は着工予定日以降の日付を選択してください。');\n    }\n    if (!pending) {\n      const token = values.get('cf-turnstile-response');\n      if (!token) throw new Error('「私はロボットではありません」を確認してから送信してください。');\n      status.textContent = '送信の準備をしています…';\n      const fields = Object.fromEntries(['company', 'contact', 'email', 'start', 'finish'].map(name => [name, values.get(name)]));\n      pending = await post('/api/prepare', { ...fields, token, files: files.map(file => ({ name: file.name, size: file.size })) });\n      pending.offsets = files.map(() => 0);\n    }\n    for (let i = 0; i < files.length; i++) {\n      const file = files[i];\n      const key = pending.uploads[i];\n      status.textContent = `ファイルを送信しています（${i + 1}/${files.length}）`;\n      while (pending.offsets[i] < file.size) {\n        const start = pending.offsets[i];\n        const end = Math.min(start + pending.chunkSize, file.size);\n        let result;\n        try {\n          result = await uploadChunk(key, `bytes ${start}-${end - 1}/${file.size}`, file.slice(start, end));\n        } catch (error) {\n          result = await uploadChunk(key, 'bytes */' + file.size).catch(() => { throw error; });\n          if (result.offset === start) throw error;\n        }\n        if (result.offset <= start || result.offset > file.size) throw new Error('ファイルの送信が止まりました。もう一度お試しください。');\n        pending.offsets[i] = result.offset;\n      }\n    }\n    status.textContent = '受付内容を記録しています…';\n    await post('/api/finish', { receipt: pending.receipt });\n    location.replace('/complete');\n  } catch (error) {\n    status.className = 'status error';\n    status.textContent = error.message || '送信できませんでした。もう一度お試しください。';\n    if (!pending && window.turnstile) turnstile.reset();\n  } finally {\n    submit.disabled = false;\n    inputs.forEach(element => { element.disabled = false; });\n  }\n});\n</script>\n</body>\n</html>\n".replace("/logo.png", LOGO);
const COMPLETE = "<!doctype html><html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>お申し込み完了 | 株式会社カイトー商会</title><style>\n:root{font-family:Manrope,\"Noto Sans JP\",sans-serif;color:#171717;background:#f5f5f3}*{box-sizing:border-box}body{margin:0}header{background:#fff;border-bottom:1px solid #e4e4e4}.header-inner{max-width:1080px;margin:auto;padding:12px 24px}.logo{width:240px;max-width:75%;height:auto}main{min-height:70vh;display:grid;place-items:center;padding:64px 24px}.panel{text-align:center;background:white;border:1px solid #e5e5e5;padding:64px 40px;max-width:680px;width:100%}.mark{display:grid;place-items:center;width:64px;height:64px;border:2px solid #0058a8;border-radius:50%;margin:0 auto 24px;color:#0058a8;font-size:30px}.eyebrow{font-size:12px;letter-spacing:.12em;color:#0058a8;font-weight:700}h1{font-size:30px;line-height:1.4;margin:16px 0 24px}p{color:#555;line-height:1.9;margin:0}a{display:inline-block;color:#0058a8;font-size:14px;margin-top:32px;text-decoration:underline}a:focus-visible{outline:3px solid #89bce7;outline-offset:4px}.foot{max-width:1080px;margin:auto;padding:24px;color:#777;font-size:12px;border-top:1px solid #ddd}@media(max-width:720px){.panel{padding:40px 24px}h1{font-size:24px}main{padding:40px 16px}}\n</style></head><body><header><div class=\"header-inner\"><img class=\"logo\" src=\"/logo.png\" alt=\"株式会社カイトー商会\"></div></header><main><section class=\"panel\" aria-labelledby=\"title\"><div class=\"mark\" aria-hidden=\"true\">✓</div><div class=\"eyebrow\">受付完了</div><h1 id=\"title\">お申し込みが<br>完了しました</h1><p>ご提出ありがとうございます。<br>お送りいただいた内容を確認いたします。</p><a href=\"/\">フォームへ戻る</a></section></main><footer class=\"foot\">© 株式会社カイトー商会</footer></body></html>\n".replace("/logo.png", LOGO);
const MAX_FILE = 10 * 1024 * 1024;
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
const CHUNK_SIZE = 4 * 1024 * 1024;
const encoder = new TextEncoder();

async function readBody(request, limit) {
  const reader = request.body?.getReader();
  const bytes = new Uint8Array(limit);
  if (!reader) return bytes.subarray(0, 0);
  let offset = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) return bytes.subarray(0, offset);
    if (offset + value.byteLength > limit) {
      await reader.cancel();
      throw new Error('Request body too large');
    }
    bytes.set(value, offset);
    offset += value.byteLength;
  }
}

async function readJson(request) {
  return JSON.parse(new TextDecoder().decode(await readBody(request, 65536)));
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function capability(value, secret) {
  const payload = btoa(String.fromCharCode(...encoder.encode(JSON.stringify({ ...value, expires: Date.now() + 6 * 3600 * 1000 }))));
  return payload + '.' + await sign(payload, secret);
}

async function readCapability(token, kind, secret) {
  if (typeof token !== 'string' || token.length > 65536 ||
      !/^[A-Za-z0-9+/]+={0,2}\.[A-Za-z0-9+/]{43}=$/.test(token)) return null;
  const [payload, signature] = token.split('.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(signature), c => c.charCodeAt(0)), encoder.encode(payload))) return null;
  const value = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0))));
  return value.kind === kind && value.expires >= Date.now() ? value : null;
}

async function scriptRequest(env, data) {
  const response = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ ...data, secret: env.SHARED_SECRET }),
  });
  if (!response.ok) throw new Error('Apps Script request failed');
  const result = await response.json();
  if (!result.ok) throw new Error('Apps Script operation failed');
  return result;
}

async function prepareUploads(request, env) {
  const data = await readJson(request);
  const fields = Object.fromEntries(['company', 'contact', 'email', 'start', 'finish'].map(name => [name, typeof data[name] === 'string' ? data[name].trim() : '']));
  const { company, contact, email, start, finish } = fields;
  const validDate = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!company || company.length > 100 || !contact || contact.length > 100 || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validDate(start) || !validDate(finish) || (start && finish && finish < start)) {
    return json({ error: '入力内容をご確認ください。' }, 400);
  }
  const files = data.files;
  if (!Array.isArray(files) || !files.length || files.length > 20 ||
      files.some(file => !file || typeof file.name !== 'string' || file.name.length > 200 ||
        !/\.(pdf|jww)$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0) ||
      files.filter(file => /\.pdf$/i.test(file.name)).length > 10 ||
      files.filter(file => /\.jww$/i.test(file.name)).length > 10) {
    return json({ error: 'PDFとJWWは、それぞれ10ファイルまで添付できます。' }, 400);
  }
  const verify = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(data.token || '') });
  const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: verify });
  if (!verification.ok || !(await verification.json()).success) return json({ error: '「私はロボットではありません」を確認してから送信してください。' }, 403);
  const prepared = await scriptRequest(env, { action: 'prepare', company, files });
  const uploads = await Promise.all(prepared.uploads.map(({ url, size, type }) =>
    capability({ kind: 'upload', url, size, type }, env.SHARED_SECRET)));
  const receipt = await capability({ kind: 'receipt', fields, folderId: prepared.folderId,
    files: prepared.uploads.map(({ id, size, name }) => ({ id, size, name })) }, env.SHARED_SECRET);
  return json({ uploads, receipt, chunkSize: CHUNK_SIZE });
}

async function relayChunk(request, env) {
  const upload = await readCapability(request.headers.get('X-Upload-Key'), 'upload', env.SHARED_SECRET);
  if (!upload) return json({ error: 'アップロードの有効期限が切れました。' }, 403);
  const url = new URL(upload.url);
  if (url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith('/upload/drive/v3/files')) throw new Error('Invalid upload destination');
  const range = request.headers.get('Content-Range');
  const probe = range === 'bytes */' + upload.size;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range || '');
  const start = match ? Number(match[1]) : 0;
  const end = match ? Number(match[2]) : 0;
  const length = probe ? 0 : end - start + 1;
  if (!probe && (!match || Number(match[3]) !== upload.size || end >= upload.size || length <= 0 ||
      length > CHUNK_SIZE || (end + 1 < upload.size && length % (256 * 1024)))) return json({ error: 'ファイルの送信範囲が正しくありません。' }, 400);

  let body;
  if (!probe) {
    const bytes = await readBody(request, length);
    if (bytes.byteLength !== length) return json({ error: 'ファイルの送信範囲が正しくありません。' }, 400);
    if (start === 0 && upload.type === 'application/pdf' && new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') {
      return json({ error: 'PDFの形式をご確認ください。' }, 400);
    }
    body = bytes;
  }
  const response = await fetch(url, { method: 'PUT', redirect: 'manual', body,
    headers: { 'Content-Range': range, 'Content-Length': String(length), 'Content-Type': upload.type } });
  if (response.status === 308) {
    const received = /^bytes=0-(\d+)$/.exec(response.headers.get('Range') || '');
    return json({ offset: received ? Number(received[1]) + 1 : 0 });
  }
  if (response.ok) return json({ offset: upload.size });
  return json({ error: 'ファイルを保存できませんでした。' }, response.status >= 500 ? 502 : 409);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response(HTML, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    if (request.method === 'GET' && url.pathname === '/complete') return new Response(COMPLETE, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
    if (request.method === 'GET' && url.pathname === '/api/config') return json({ siteKey: env.TURNSTILE_SITE_KEY || '' });
    const isUpload = request.method === 'PUT' && url.pathname === '/api/upload';
    const isSubmission = request.method === 'POST' && ['/api/submit', '/api/prepare', '/api/finish'].includes(url.pathname);
    if (!isUpload && !isSubmission) return new Response('Not found', { status: 404, headers });
    if (!env.APPS_SCRIPT_URL || !env.SHARED_SECRET || !env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) return json({error:'現在、受付の準備中です。担当者にお問い合わせください。'}, 503);
    if (url.pathname !== '/api/submit') {
      const maxLength = isUpload ? CHUNK_SIZE : 65536;
      if (Number(request.headers.get('content-length') || 0) > maxLength) return json({ error: '送信データが大きすぎます。' }, 413);
      try {
        if (isUpload) return await relayChunk(request, env);
        if (url.pathname === '/api/prepare') return await prepareUploads(request, env);
        const receipt = await readCapability((await readJson(request)).receipt, 'receipt', env.SHARED_SECRET);
        if (!receipt) return json({ error: '受付の有効期限が切れました。' }, 403);
        const { fields, folderId, files } = receipt;
        await scriptRequest(env, { action: 'finish', ...fields, folderId, files });
        return json({ ok: true });
      } catch {
        return json({ error: '受付処理を完了できませんでした。担当者にご確認ください。' }, 502);
      }
    }
    if (Number(request.headers.get('content-length') || 0) > MAX_FILE + 65536) return json({error:'PDFのサイズは10 MB以内にしてください。'}, 413);
    try {
      const form = await request.formData();
      const token = form.get('cf-turnstile-response');
      const verify = new URLSearchParams({secret:env.TURNSTILE_SECRET, response:typeof token === 'string' ? token : ''});
      const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {method:'POST', body:verify});
      if (!verification.ok || !(await verification.json()).success) return json({error:'確認が完了しませんでした。画面を再読み込みしてお試しください。'}, 403);
      const text = name => typeof form.get(name) === 'string' ? form.get(name).trim() : '';
      const company=text('company'), contact=text('contact'), email=text('email'), start=text('start'), finish=text('finish');
      const file=form.get('drawing');
      if (!company || company.length>100 || !contact || contact.length>100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || !(file instanceof File) || !/\.pdf$/i.test(file.name) || file.size<5 || file.size>MAX_FILE || (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (finish && !/^\d{4}-\d{2}-\d{2}$/.test(finish)) || (start && finish && finish<start)) return json({error:'入力内容とPDFファイルをご確認ください。'}, 400);
      const bytes=new Uint8Array(await file.arrayBuffer());
      if (String.fromCharCode(...bytes.slice(0,5)) !== '%PDF-') return json({error:'PDFファイルをご確認ください。'},400);
      // Chunks prevent the argument-count overflow from spreading a large PDF.
      let binary=''; for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const payload={secret:env.SHARED_SECRET, company, contact, email, start, finish, filename:file.name.slice(0,200), pdf:btoa(binary)};
      const upstream=await fetch(env.APPS_SCRIPT_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),redirect:'follow'});
      if(!upstream.ok) throw new Error('upstream');
      const result=await upstream.json();
      if(!result.ok) return json({error:'受付処理を完了できませんでした。重複送信を避けるため、担当者へご確認ください。'},502);
      return json({ok:true});
    } catch { return json({error:'受付処理を確認できませんでした。重複送信を避けるため、担当者へご確認ください。'},502); }
  }
};
