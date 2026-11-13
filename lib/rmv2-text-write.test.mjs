import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLogicalText,prepareLogicalTextAsync,RmTextWrites} from './rmv2-text-write.mjs';

const owner={sessionId:'session_test',agentId:'agent_test'},scope={desktopSessionId:'desk_test123'};
function fixture(extra={}){
  const calls=[],tasks=[];let sent=0,id=0;
  const native={
    async start(_scope,p){calls.push(['start',p]);return {target:{fingerprint:'target'},verificationAvailable:true,verificationMethod:'test-readback'};},
    async chunk(_scope,p){calls.push(['chunk',p]);sent+=p.text.length;return {state:'running',sentUnits:sent};},
    async finish(_scope,p){calls.push(['finish',p]);return {contentVerification:p.complete?'verified':'unverified',verifiedInsertedUnits:p.complete?sent:null};},
    async cancel(){calls.push(['cancel']);},...extra
  };
  const writes=new RmTextWrites({native,id:()=> 'write_test'+(++id),withScope:(_s,run)=>{const task=Promise.resolve().then(run);tasks.push(task);return task;}});
  return {writes,calls,tasks,native,async settled(){await Promise.all(tasks);}};
}

test('16K/64K/256K Unicode logical writes retain exact grapheme and CRLF boundaries',()=>{
  for(const length of [16384,65536,262144]){
    const seed='Đây là 👩🏽‍💻\r\n';let text=seed.repeat(Math.floor(length/seed.length));text+='x'.repeat(length-text.length);
    const prepared=prepareLogicalText({text,intervalMs:0});assert.equal(prepared.chunks.join(''),text);
    const boundaries=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(x=>x.index));boundaries.add(text.length);
    let offset=0;for(const chunk of prepared.chunks){assert.ok(chunk.length<=256);assert.equal(chunk.isWellFormed(),true);offset+=chunk.length;assert.ok(boundaries.has(offset));}
  }
});

test('invalid Unicode fails before target preparation; invalid trailing grapheme cannot send a valid prefix',async()=>{
  const x=fixture();await assert.rejects(x.writes.start(owner,scope,{operationId:'op_invalid',text:'ok\ud800'}),/unicode/);
  assert.equal(x.calls.length,0);
  const one=await x.writes.start(owner,scope,{operationId:'op_invalid_grapheme',text:'valid prefix'.repeat(1000)+'a'+'\u0301'.repeat(128)});await x.settled();
  const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'failed');assert.match(final.reason,/grapheme/);
  assert.equal(final.acceptedUnits,0);assert.equal(final.sentUnits,0);assert.equal(x.calls.filter(c=>c[0]==='chunk').length,0);
  assert.throws(()=>prepareLogicalText({text:{value:'abc'}}),/string_required/);
});

test('required verification unavailable rejects before a single input chunk',async()=>{
  const x=fixture({async start(){return {verificationAvailable:false};}});
  await assert.rejects(x.writes.start(owner,scope,{operationId:'op_required',text:'secret',verification:'required'}),/verification_unavailable/);
  assert.equal(x.calls.filter(c=>c[0]==='chunk').length,0);assert.equal(x.writes.active,null);
});

test('one logical write chunks internally and reports verified only after full readback',async()=>{
  const x=fixture();const first=await x.writes.start(owner,scope,{operationId:'op_long',text:'x'.repeat(16000)});
  await x.settled();const final=x.writes.status(owner,first.writeId);
  assert.equal(final.state,'verified');assert.equal(final.verifiedInsertedUnits,16000);
  assert.ok(x.calls.filter(c=>c[0]==='chunk').length>1);
  assert.ok(x.calls.filter(c=>c[0]==='chunk').every(c=>Number.isInteger(c[1].authorityBudgetMs)&&c[1].authorityBudgetMs>0&&c[1].authorityBudgetMs<=1000));
  assert.equal(JSON.stringify(final).includes('xxxx'),false);assert.equal(final.automaticReplay,false);
  assert.throws(()=>x.writes.status({...owner,agentId:'foreign'},first.writeId),/owner_mismatch/);
});

test('duplicate operation is not typed twice and conflicting input is rejected',async()=>{
  const x=fixture(),request={operationId:'op_dedupe',text:'hello'};
  const one=await x.writes.start(owner,scope,request);await x.settled();
  const two=await x.writes.start(owner,scope,request);assert.equal(two.writeId,one.writeId);
  assert.equal(x.calls.filter(c=>c[0]==='start').length,1);
  await assert.rejects(x.writes.start(owner,scope,{...request,text:'changed'}),/operation_conflict/);
});

test('lost chunk response leaves unknown effects and never replays remaining text',async()=>{
  let attempts=0;const x=fixture({async chunk(){attempts++;throw Error('native_timeout');}});
  const one=await x.writes.start(owner,scope,{operationId:'op_timeout',text:'x'.repeat(2000)});await x.settled();
  const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'indeterminate');assert.equal(final.sentUnits,null);
  assert.equal(final.verifiedInsertedUnits,null);assert.equal(attempts,1);assert.equal(final.resumable,false);
});

test('cancel during a pending chunk stops later chunks but retains task ownership',async()=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{entered=resolve;});let chunks=0;
  const x=fixture({async chunk(_scope,p){chunks++;entered();await gate;return {state:'running',sentUnits:p.text.length};}});
  const one=await x.writes.start(owner,scope,{operationId:'op_cancel',text:'x'.repeat(2000)});
  await pending;const cancel=await x.writes.cancel(owner,one.writeId);assert.equal(cancel.cancelRequested,true);release();await x.settled();
  assert.equal(x.writes.status(owner,one.writeId).state,'cancelled');assert.equal(chunks,1);
  assert.equal(x.writes.status(owner,one.writeId).desktopSessionId,scope.desktopSessionId);
});

test('provider mismatch or malformed verification cannot be reported fully verified',async()=>{
  const x=fixture({async finish(){return {contentVerification:'mismatch',verifiedInsertedUnits:null};}});
  const one=await x.writes.start(owner,scope,{operationId:'op_mismatch',text:'hello'});await x.settled();
  assert.equal(x.writes.status(owner,one.writeId).state,'mismatch');
  const bad=fixture({async finish(){return {contentVerification:'verified',verifiedInsertedUnits:999};}});
  const two=await bad.writes.start(owner,scope,{operationId:'op_bad',text:'hello'});await bad.settled();
  assert.equal(bad.writes.status(owner,two.writeId).state,'indeterminate');
});

test('a native unobserved prefix stops every later chunk without replay or final success',async()=>{
  let calls=0;const x=fixture({async chunk(_s,p){calls++;return {state:'interrupted',reason:'desktop_text_delivery_not_observed_reconcile',sentUnits:p.text.length,lastObservedInsertedUnits:0};}});
  const one=await x.writes.start(owner,scope,{operationId:'op_not_delivered',text:'x'.repeat(2000)});await x.settled();
  const result=x.writes.status(owner,one.writeId);assert.equal(calls,1);assert.equal(result.state,'interrupted');assert.equal(result.sentUnits,256);
  assert.equal(result.lastObservedInsertedUnits,0);assert.equal(result.verifiedInsertedUnits,null);assert.equal(result.automaticReplay,false);
  assert.equal(x.calls.find(c=>c[0]==='finish')[1].complete,false);
});

test('scope closure stops logical work without starting another chunk',async()=>{
  let open=true,seen=0;const x=fixture({async chunk(_s,p){seen++;open=false;return {state:'running',sentUnits:p.text.length};}});
  x.writes.isScopeOpen=()=>open;
  const one=await x.writes.start(owner,scope,{operationId:'op_closed',text:'x'.repeat(2000)});await x.settled();
  assert.equal(x.writes.status(owner,one.writeId).state,'cancelled');assert.equal(seen,1);
});

test('unknown write after restart requires reconciliation rather than replay',()=>{
  assert.throws(()=>fixture().writes.status(owner,'write_previous_process'),/unknown_after_restart/);
});


test('revocation before a subsequent chunk preserves known prefix and stops unsent input',async()=>{
 const x=fixture();let revoked=false;const original=x.native.chunk;x.native.chunk=async(...args)=>{const ack=await original(...args);revoked=true;return ack;};x.writes.authorize=async()=>{if(revoked)throw Error('revoked');return {validForMs:1000};};
 const one=await x.writes.start(owner,scope,{operationId:'op_revoked',text:'x'.repeat(2000)});await x.settled();
 const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'interrupted');assert.equal(final.sentUnits,256);assert.equal(final.reason,'revoked');
 assert.equal(x.calls.filter(c=>c[0]==='chunk').length,1);
});
test('monotonic deadline is independent of wall clock and stops before next input chunk',async()=>{
 const x=fixture();let tick=0;x.writes.monotonic=()=>tick;
 const chunk=x.native.chunk;x.native.chunk=async(...args)=>{const r=await chunk(...args);tick+=1001;return r;};
 const one=await x.writes.start(owner,scope,{operationId:'op_deadline',text:'x'.repeat(2000),maxDurationMs:1000});await x.settled();
 const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'interrupted');assert.equal(final.reason,'desktop_write_deadline_exceeded');assert.equal(final.sentUnits,256);
});
test('authority roundtrip longer than its validity cannot authorize delayed input',async()=>{
 const x=fixture();let tick=0;x.writes.monotonic=()=>tick;x.writes.authorize=async()=>{tick+=1001;return {validForMs:1000};};
 await assert.rejects(x.writes.start(owner,scope,{operationId:'op_expired_snapshot',text:'x'}),/authority_expired/);
 assert.equal(x.calls.filter(c=>c[0]==='start').length,0);
});


test('cooperative preparation services event loop without splitting any grapheme',async()=>{
 let serviced=false;setImmediate(()=>{serviced=true;});
 const text=('Unicode '+String.fromCodePoint(0x1f600)+' e\u0301\r\n').repeat(12000);
 const prepared=await prepareLogicalTextAsync({text});assert.equal(serviced,true);assert.equal(prepared.chunks.join(''),text);
});
test('cancel during preparation is responsive and cannot emit even a first input packet',async()=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{entered=resolve;});
 const x=fixture();x.writes.prepareYield=async()=>{entered();await gate;};
 const one=await x.writes.start(owner,scope,{operationId:'op_prepare_cancel',text:'x'.repeat(65536)});await pending;
 const preparing=x.writes.status(owner,one.writeId);assert.equal(preparing.state,'preparing');assert.equal(preparing.acceptedUnits,0);assert.equal(preparing.sentUnits,0);
 await x.writes.cancel(owner,one.writeId);release();await x.settled();
 assert.equal(x.writes.status(owner,one.writeId).state,'cancelled');assert.equal(x.calls.filter(c=>c[0]==='chunk').length,0);
});
test('native target binds before cooperative preparation can yield to a changed focus',async()=>{
 let focus='original',bound,release,entered;const gate=new Promise(resolve=>{release=resolve;}),pending=new Promise(resolve=>{entered=resolve;});
 const x=fixture({async start(){bound=focus;return {verificationAvailable:true};},async chunk(){assert.equal(bound,'original');assert.equal(focus,'other');return {state:'interrupted',sentUnits:0,reason:'focused_control_changed'};}});
 x.writes.prepareYield=async()=>{entered();await gate;};
 const one=await x.writes.start(owner,scope,{operationId:'op_prepare_focus',text:'x'.repeat(65536)});await pending;focus='other';release();await x.settled();
 const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'interrupted');assert.equal(final.sentUnits,0);assert.equal(bound,'original');
});
test('impossible pacing budget rejects before input instead of allocating days of chunks',async()=>{
 const x=fixture();const one=await x.writes.start(owner,scope,{operationId:'op_pacing_budget',text:'x'.repeat(20000),intervalMs:100,maxDurationMs:1000});await x.settled();
 const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'failed');assert.match(final.reason,/pacing_exceeds_deadline/);
 assert.equal(final.sentUnits,0);assert.equal(x.calls.filter(c=>c[0]==='chunk').length,0);
});
