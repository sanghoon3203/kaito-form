import worker from './worker-built.js';
import assert from 'node:assert/strict';

const env = { APPS_SCRIPT_URL: 'https://script.test/', SHARED_SECRET: 'test', TURNSTILE_SECRET: 'test', TURNSTILE_SITE_KEY: 'test' };
const input = {
  company: 'テスト会社', contact: '担当', email: 'test@example.com', start: '', finish: '', token: 'test',
  files: [{ name: '図面.pdf', size: 11 * 1024 * 1024 }, { name: '別図面.JWW', size: 5 }],
};
const stored = [0, 0];
let finished = false;
globalThis.fetch = async (url, options) => {
  if (String(url).includes('siteverify')) return Response.json({ success: true });
  if (String(url) === env.APPS_SCRIPT_URL) {
    const data = JSON.parse(options.body);
    if (data.action === 'prepare') return Response.json({
      ok: true, folderId: 'test-folder', uploads: data.files.map((file, i) => ({
        ...file, id: String(i), type: i === 0 ? 'application/pdf' : 'application/octet-stream',
        url: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=' + i,
      })),
    });
    assert.equal(data.action, 'finish');
    assert.deepEqual(stored, input.files.map(file => file.size));
    assert.deepEqual(data.files.map(file => file.name), input.files.map(file => file.name));
    finished = true;
    return Response.json({ ok: true });
  }
  const i = Number(new URL(url).searchParams.get('upload_id'));
  stored[i] += options.body.byteLength;
  if (stored[i] === input.files[i].size) return Response.json({ id: String(i) });
  return new Response(null, { status: 308, headers: { Range: 'bytes=0-' + (stored[i] - 1) } });
};
const request = (path, options) => worker.fetch(new Request('https://form.test' + path, options), env);
const post = (path, payload) => request(path, { method: 'POST', body: JSON.stringify(payload) });

const rejected = await post('/api/prepare', { ...input, files: Array(11).fill(input.files[0]) });
assert.equal(rejected.status, 400);
const response = await post('/api/prepare', input);
assert.equal(response.status, 200);
const { uploads, receipt, chunkSize } = await response.json();
assert.equal(uploads.length, 2);
for (let i = 0; i < input.files.length; i++) {
  const size = input.files[i].size;
  for (let offset = 0; offset < size;) {
    const end = Math.min(offset + chunkSize, size);
    const body = new Uint8Array(end - offset);
    if (i === 0 && offset === 0) body.set(new TextEncoder().encode('%PDF-'));
    const response = await request('/api/upload', {
      method: 'PUT', body, headers: { 'X-Upload-Key': uploads[i], 'Content-Range': `bytes ${offset}-${end - 1}/${size}` },
    });
    assert.equal(response.status, 200);
    offset = (await response.json()).offset;
    assert.equal(offset, end);
  }
}
assert.equal((await post('/api/finish', { receipt: receipt + 'invalid' })).status, 403);
assert.equal((await post('/api/finish', { receipt })).status, 200);
assert.equal(finished, true);
console.log('Verified PDF count rejection, 11 MB PDF in chunks, JWW, and signed completion.');
