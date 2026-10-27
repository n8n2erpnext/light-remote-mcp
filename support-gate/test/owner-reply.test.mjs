import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseReply,htmlFromPlainText,rawNativeCsrf,lastPublicMessage} from '../src/owner-reply.mjs';
const a='3793225f-4bcc-4ff3-9a29-ab3b16d231e7';
const b='402acea3-e0c5-42c2-a3e3-d7f8633cbc3a';
test('owner reply requires exact recipient, baseline, unique request id',()=>{
 assert.equal(parseReply({recipient:' User@Example.Com ',message:' Hello ',baseline:a,request_id:b}).recipient,'user@example.com');
 for(const invalid of [
  {recipient:'bad',message:'test',baseline:a,request_id:b},
  {recipient:'a@b.co',message:'',baseline:a,request_id:b},
  {recipient:'a@b.co',message:'x',baseline:'invalid',request_id:b},
  {recipient:'a@b.co',message:'x',baseline:a,request_id:'invalid'}
 ])assert.throws(()=>parseReply(invalid),/invalid_owner_reply/);
});
test('plain text never injects html into native reply',()=>{
 assert.equal(htmlFromPlainText('<script>x&"\'\nnext'),'<p>&lt;script&gt;x&amp;&quot;&#39;<br>next</p>');
});
test('raw CSRF remains literal and bounded',()=>{
 assert.equal(rawNativeCsrf('libredesk_session=a; csrf_token=AbC%2F'), 'AbC%2F');
 assert.equal(rawNativeCsrf('libredesk_session=a'), '');
});
test('latest public message excludes private staff notes',()=>{
 const list=[{uuid:a,private:false,type:'incoming',created_at:'2026-10-27T02:51:00Z'},
 {uuid:b,private:true,type:'outgoing',created_at:'2026-10-27T02:55:00Z'}];
 assert.equal(lastPublicMessage(list),a);
});
test('owner native send is identity-guarded, explicit POST and duplicate locked',()=>{
 const source=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/const s=await guard\(req,res,method!=='GET'\)/);
 assert.match(source,/method==='POST'&&ownerReplyMatch/);
 assert.match(source,/ON CONFLICT DO NOTHING RETURNING request_id/);
 assert.match(source,/rawNativeCsrf\(req.headers.cookie\)/);
 assert.match(source,/contact.toLowerCase\(\)!==input.recipient/);
 assert.match(ui,/manualPending=/);
 assert.match(ui,/sendConfirmText/);
 assert.match(ui,/sendManual/);
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 assert.match(html,/id="aiDraft"/);
 assert.match(html,/id="threadPanel"/);
});
