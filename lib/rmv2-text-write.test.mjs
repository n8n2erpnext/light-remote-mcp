import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLogicalText,RmTextWrites} from './rmv2-text-write.mjs';

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
    let offset=0;for(const chunk of prepared.chunks){assert.equal(chunk.isWellFormed(),true);offset+=chunk.length;assert.ok(boundaries.has(offset));}
  }
});

test('invalid full payload and an oversized grapheme fail before native preparation',async()=>{
  const x=fixture();
  for(const text of ['ok\ud800','a'+'\u0301'.repeat(4096)])await assert.rejects(x.writes.start(owner,scope,{operationId:'op_invalid',text}),/unicode|grapheme/);
  assert.equal(x.calls.length,0);
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
 const x=fixture();let checks=0;x.writes.authorize=async()=>{if(++checks>2)throw Error('revoked');return {validForMs:1000};};
 const one=await x.writes.start(owner,scope,{operationId:'op_revoked',text:'x'.repeat(2000)});await x.settled();
 const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'interrupted');assert.equal(final.sentUnits,512);assert.equal(final.reason,'revoked');
 assert.equal(x.calls.filter(c=>c[0]==='chunk').length,1);
});
test('monotonic deadline is independent of wall clock and stops before next input chunk',async()=>{
 const x=fixture();let tick=0;x.writes.monotonic=()=>tick;
 const chunk=x.native.chunk;x.native.chunk=async(...args)=>{const r=await chunk(...args);tick+=1001;return r;};
 const one=await x.writes.start(owner,scope,{operationId:'op_deadline',text:'x'.repeat(2000),maxDurationMs:1000});await x.settled();
 const final=x.writes.status(owner,one.writeId);assert.equal(final.state,'interrupted');assert.equal(final.reason,'desktop_write_deadline_exceeded');assert.equal(final.sentUnits,512);
});
test('authority roundtrip longer than its validity cannot authorize delayed input',async()=>{
 const x=fixture();let tick=0;x.writes.monotonic=()=>tick;x.writes.authorize=async()=>{tick+=1001;return {validForMs:1000};};
 await assert.rejects(x.writes.start(owner,scope,{operationId:'op_expired_snapshot',text:'x'}),/authority_expired/);
 assert.equal(x.calls.filter(c=>c[0]==='start').length,0);
});
