// Build with build.py. Configure the secrets and Turnstile keys in Cloudflare.
const HTML = __HTML__;
const COMPLETE = __COMPLETE__;
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
