import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldMemoryContentRelay} from './gold-memory-content-relay.mjs';
import {memoryControlResult,normalizeMemoryRequest} from '../lib/gold-memory-operation.mjs';
const owner={accountId:'a1',deviceId:'d1',agentId:'agent1',sessionId:'session1'};
const content={action:'save',title:'Sentinel title',body:'PRIVATE_MEMORY_SENTINEL_9a7',source:'explicit-owner'};
test('RAM relay binds all principals and immutable operation/reply, metadata contains no content',()=>{
 const r=new GoldMemoryContentRelay();try{
  const ticket=r.put(owner,'memory-op-test-0001',content);
  assert.doesNotMatch(JSON.stringify(ticket),/PRIVATE_MEMORY|Sentinel title|explicit-owner/);
  assert.deepEqual(r.put(owner,'memory-op-test-0001',content),ticket);
  assert.throws(()=>r.put(owner,'memory-op-test-0001',{...content,body:'changed'}),/conflict/);
  for(const key of Object.keys(owner)){
   const wrong={...owner,[key]:'wrong'};
   assert.throws(()=>r.fetch(wrong,ticket.requestRef,ticket.requestDigest),/unavailable/);
   assert.throws(()=>r.push(wrong,ticket.requestRef,{ok:true,result:content}),/unavailable/);
   assert.throws(()=>r.read(wrong,ticket.requestRef),/unavailable/);
  }
  assert.throws(()=>r.fetch(owner,ticket.requestRef,'bad'),/conflict/);
  const fetched=r.fetch(owner,ticket.requestRef,ticket.requestDigest);fetched.request.body='mutated';
  assert.equal(r.fetch(owner,ticket.requestRef,ticket.requestDigest).request.body,content.body);
  assert.deepEqual(r.read(owner,ticket.requestRef),{ok:false,pending:true});
  r.push(owner,ticket.requestRef,{ok:true,result:{body:content.body},ignored:'untrusted'});
  const reply=r.read(owner,ticket.requestRef);assert.equal(reply.result.body,content.body);assert.equal(reply.ignored,undefined);
  r.push(owner,ticket.requestRef,{ok:true,result:{body:content.body}});
  assert.throws(()=>r.push(owner,ticket.requestRef,{ok:true,result:'different'}),/conflict/);
  const control=memoryControlResult({ok:true,memory:{requestRef:ticket.requestRef,phase:'completed',body:content.body},result:content});
  assert.doesNotMatch(JSON.stringify(control),/PRIVATE_MEMORY|body|title/);
 }finally{r.dispose();}
});
test('absolute TTL, no read renewal, restart loss and bounded capacity',()=>{
 let now=0;const r=new GoldMemoryContentRelay({now:()=>now,maxRows:1,maxBytes:2000});try{
  const ticket=r.put(owner,'memory-op-test-0002',content);now=119999;
  r.read(owner,ticket.requestRef);assert.throws(()=>r.put(owner,'memory-op-test-0003',content),/busy/);
  now=120000;assert.throws(()=>r.read(owner,ticket.requestRef),/unavailable/);assert.equal(r.bytes,0);
  const newer=r.put(owner,'memory-op-test-0002',content);assert.notEqual(newer.requestRef,ticket.requestRef);
  r.dispose();assert.throws(()=>r.read(owner,newer.requestRef),/unavailable/);
 }finally{r.dispose();}
});
test('canonical validation rejects invalid ranges and strips caller actor/root/command',()=>{
 const v=normalizeMemoryRequest({...content,script:'evil',accountId:'fake',clientRoot:'/wrong'});
 assert.deepEqual(Object.keys(v),['action','title','body','source','kind']);
 for(const input of [{action:'exec'},{...content,body:'x'.repeat(12001)},{action:'get',id:'-'.repeat(36)},{action:'handoff',limit:30},{action:'scope_full_context',scopeId:'bad'}])assert.throws(()=>normalizeMemoryRequest(input),/request_invalid/);
});
