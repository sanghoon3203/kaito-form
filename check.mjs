import worker from './worker-built.js';
import assert from 'node:assert/strict';

const env={APPS_SCRIPT_URL:'https://example.test/exec',SHARED_SECRET:'test',TURNSTILE_SECRET:'test',TURNSTILE_SITE_KEY:'test'};
let forwarded;
globalThis.fetch=async (url,options)=>{
  if(String(url).includes('siteverify')) return Response.json({success:true});
  forwarded=JSON.parse(options.body); return Response.json({ok:true});
};
const makeForm=(content='%PDF-1.4 test')=>{
  const f=new FormData();
  for(const [k,v] of Object.entries({company:'テスト会社',contact:'山田',email:'test@example.com',start:'2026-12-01',finish:'2026-12-10','cf-turnstile-response':'token'}))f.set(k,v);
  f.set('drawing',new File([content],'sample.pdf',{type:'application/pdf'})); return f;
};
let response=await worker.fetch(new Request('https://example.test/'),{});
assert.equal(response.status,200); assert.match(await response.text(),/工事完了予定日/);
response=await worker.fetch(new Request('https://example.test/api/submit',{method:'POST',body:makeForm()}),{});
assert.equal(response.status,503);
response=await worker.fetch(new Request('https://example.test/api/submit',{method:'POST',body:makeForm()}),env);
assert.equal(response.status,200); assert.equal(forwarded.company,'テスト会社'); assert.equal(Buffer.from(forwarded.pdf,'base64').toString(),'%PDF-1.4 test');
response=await worker.fetch(new Request('https://example.test/api/submit',{method:'POST',body:makeForm('not a pdf')}),env);
assert.equal(response.status,400);
console.log('Worker checks passed: page, missing setup, valid submission, invalid PDF.');
