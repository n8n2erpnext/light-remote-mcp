import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {signature,validSignedIntake,validateTicketPayload,nativeTicketBody,createGoldTicket} from '../src/gold-intake.mjs';
const id='0ed89af0-2bb5-4ea2-8d4b-afb6069982ba',secret='x'.repeat(64);
const raw=JSON.stringify({email:'owner@example.org',subject:'Test intake',description:'Hello <script>alert(1)</script>',problemArea:'other',deviceStatus:'unknown'});
test('only timestamp-bounded signed requests with unchanged body accepted',()=>{
 const now=1793100000000,ts=String(now);
 const headers={'x-gold-time':ts,'x-gold-request-id':id,'x-gold-signature':signature(secret,ts,id,raw)};
 assert.equal(validSignedIntake(secret,headers,raw,now),true);
 assert.equal(validSignedIntake(secret,headers,raw+'x',now),false);
 assert.equal(validSignedIntake(secret,headers,raw,now+300001),false);
 assert.equal(validSignedIntake(secret,{...headers,'x-gold-signature':'a'.repeat(64)},raw,now),false);
});
test('native body escapes HTML and email validation rejects invalid input',()=>{
 const d=validateTicketPayload(raw);
 assert.equal(d.email,'owner@example.org');
 const html=nativeTicketBody(d);
 assert.ok(html.includes('&lt;script&gt;'));
 assert.ok(!html.includes('<script>'));
 assert.throws(()=>validateTicketPayload(JSON.stringify({...d,email:'evil'})),/invalid_email/);
});
test('native successful creation has no bearer ticket URL exposed to browser',async()=>{
 const rows=new Map(),calls=[];
 const pg={query:async(sql,args)=>{
  if(sql.startsWith('INSERT INTO support_gate_gold_intake_requests')){
   if(rows.has(args[0]))return {rowCount:0};
   rows.set(args[0],{state:'processing'});return {rowCount:1};
  }
  if(sql.startsWith('UPDATE support_gate_gold_intake_requests')){
   rows.set(args[0],{state:'created',reference_number:args[1]});return {rowCount:1};
  }
  if(sql.startsWith('SELECT state'))return {rows:[rows.get(args[0])]};
  return {rowCount:1};
 }};
 const headers={'x-gold-time':String(1793100000000),'x-gold-request-id':id};
 headers['x-gold-signature']=signature(secret,headers['x-gold-time'],id,raw);
 const responses=[];
 const handler={headers};
 const reply=(res,status,data)=>{responses.push({status,data})};
 const invoke=()=>createGoldTicket(handler,{},{
  pool:pg,secret,apiKey:'apiKey',apiSecret:'apiSecret',inboxId:1,
  readBody:async()=>raw,sendJson:reply,
  fetchImpl:async(url,init)=>{
   calls.push({url,body:JSON.parse(init.body),auth:init.headers.authorization});
   return {ok:true,json:async()=>({data:{uuid:'5661e50c-ea21-4f7e-bef7-29b68fdf6d5c',reference_number:209}})};
  }});
 const org=Date.now;Date.now=()=>1793100000000;
 try{await invoke();await invoke()}finally{Date.now=org}
 assert.equal(calls.length,1);
 assert.equal(calls[0].body.initiator,'contact');
 assert.equal(calls[0].body.inbox_id,1);
 assert.equal(responses[0].status,201);
 assert.equal(responses[1].status,200);
 assert.ok(!JSON.stringify(responses).includes('/ai-support/t/'));
});
