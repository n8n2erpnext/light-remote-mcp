import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ticketAccessCode,verifyTicketAccessCode,makeTicketCookie,ticketCookieValid,ticketCodePage,ticketCodeHeaders,deliverTicketCode,checkCodeAttempt} from '../src/ticket-access.mjs';

const id='ef8e1c74-3b4e-46ef-8111-817fa6a51fe4';
const different='5661e50c-ea21-4f7e-bef7-29b68fdf6d5c';
const secret='0123456789abcdef0123456789abcdef0123456789abcdef';
test('independent HMAC-derived ticket codes use eight readable characters',()=>{
 const code=ticketAccessCode(secret,id);
 assert.match(code,/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
 assert.equal(verifyTicketAccessCode(secret,id,code),true);
 assert.equal(verifyTicketAccessCode(secret,id,code.toLowerCase()),true);
 assert.equal(verifyTicketAccessCode(secret,different,code),false);
 assert.notEqual(ticketAccessCode(secret,id),ticketAccessCode(secret,different));
 assert.notEqual(ticketAccessCode(secret,id),ticketAccessCode(secret.replace('0','f'),id));
 assert.equal(verifyTicketAccessCode(secret,id,'AAAA-AAAA'),false);
 assert.equal(verifyTicketAccessCode(secret,id,'__proto__'),false);
});
test('session cookie is bound to exact ticket and expires after 12 hours',()=>{
 const now=Date.UTC(2026,9,27);
 const setCookie=makeTicketCookie(secret,id,now);
 assert.match(setCookie,/HttpOnly; Secure; SameSite=Strict; Max-Age=43200/);
 const cookie=setCookie.split(';')[0];
 assert.equal(ticketCookieValid(secret,id,{cookie},now+43200*1000-1),true);
 assert.equal(ticketCookieValid(secret,id,{cookie},now+43200*1000),false);
 assert.equal(ticketCookieValid(secret,different,{cookie},now),false);
 assert.equal(ticketCookieValid(secret,id,{cookie:cookie+'tamper'},now),false);
 assert.equal(ticketCookieValid(secret,id,{},now),false);
});
test('private ticket gate never displays conversation or passcode and uses same-origin form',()=>{
 const html=ticketCodePage(id,{inboxId:2});
 assert.match(html,/Enter your ticket access code/);
 assert.match(html,/lightbi-app-icon\.png/);
 assert.match(html,/\/access\/verify/);
 assert.match(html,/\/access\/request/);
 assert.doesNotMatch(html,new RegExp(ticketAccessCode(secret,id)));
 assert.equal(ticketCodeHeaders()['referrer-policy'],'same-origin');
 assert.match(ticketCodeHeaders()['content-security-policy'],/form-action 'self'/);
});
test('DB-backed attempt cap denies attempts after six in 15 minutes',async()=>{
 let failures=0;
 const pool={query:async()=>({rows:[{failures:++failures}]})};
 for(let i=0;i<6;i++)assert.equal(await checkCodeAttempt(pool,id),true);
 assert.equal(await checkCodeAttempt(pool,id),false);
});
test('code delivery verifies original native contact and only sends one email',async()=>{
 let sends=0;
 const row={status:'pending',sent_count:0,window_started:new Date(0),last_sent_at:null};
 const statements=[];
 const client={query:async(sql)=>{
  statements.push(sql);
  if(sql.startsWith('SELECT *'))return {rows:[row]};
  return {rowCount:1};
 },release(){}};
 const pool={connect:async()=>client,query:async(sql)=>({rowCount:1})};
 const fetchImpl=async(url,options)=>{
  if(options.method==='POST'){sends++;const msg=JSON.parse(options.body).message;assert.match(msg,/ticket access code/);assert.match(msg,new RegExp(ticketAccessCode(secret,id)));assert.equal(JSON.parse(options.body).private,false);assert.equal(JSON.parse(options.body).sender_type,'agent');assert.equal(JSON.parse(options.body).send_from,'support@thaiduy.digital');assert.deepEqual(JSON.parse(options.body).to,['owner@example.test']);
   return {ok:true,json:async()=>({data:{uuid:'ad64143e-308f-403b-afc8-b08fb80cc7b2'}})};}
  return {ok:true,json:async()=>({data:{uuid:id,inbox_channel:'email',inbox_id:1,contact:{email:'owner@example.test'}}})};
 };
 const result=await deliverTicketCode(pool,id,1,{secret,apiKey:'fixture_key',apiSecret:'fixture_secret',fetchImpl,now:new Date()});
 assert.equal(result.sent,true);
 assert.equal(sends,1);
 assert.ok(statements.some(s=>s.includes('FOR UPDATE')));
});
test('code delivery never sends if recipient inbox does not match',async()=>{
 let sends=0;
 const client={query:async(sql)=>sql.startsWith('SELECT *')?{rows:[{status:'pending',sent_count:0,window_started:new Date(0),last_sent_at:null}]}:{rowCount:1},release(){}};
 const pool={connect:async()=>client,query:async()=>({rowCount:1})};
 const fetchImpl=async(url,options)=>{if(options.method==='POST')sends++;return {ok:true,json:async()=>({data:{uuid:id,inbox_channel:'email',inbox_id:2,contact:{email:'other@example.test'}}})}};
 await assert.rejects(deliverTicketCode(pool,id,1,{secret,apiKey:'fixture_key',apiSecret:'fixture_secret',fetchImpl}),/uncertain/);
 assert.equal(sends,0);
});
