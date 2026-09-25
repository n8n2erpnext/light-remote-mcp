import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createPlusTransferHandlers } from '../../gateway/plus-transfer.mjs';
import { ChunkTransferRegistry } from '../../gateway/chunk-transfer.mjs';

const require=createRequire(import.meta.url);
const {PLUS_BATCH_POLICY,inspectPlusExecPayload}=require('../../lib/plus-batch-policy.cjs');
const {toolHelperView}=require('../../lib/plus-tool-helper.js');

const base={action:'exec_batch',operationId:'plus-batch-selftest-0001',sessionId:'s_plus_batch_selftest',agentId:'agent-plus-batch-selftest-aaaa',script:'printf ok'};
assert.doesNotThrow(()=>inspectPlusExecPayload(base,{transport:'direct'}));

const medium={...base,operationId:'plus-batch-selftest-0002',script:'x'.repeat(8000),timeoutMs:7200000};
assert.throws(()=>inspectPlusExecPayload(medium,{transport:'direct'}),/plus_exec_transfer_required/);
assert.doesNotThrow(()=>inspectPlusExecPayload(medium,{transport:'transfer'}),'duration must not force split or process');

const huge={...base,operationId:'plus-batch-selftest-0003',script:'x'.repeat(PLUS_BATCH_POLICY.maxExecScriptBytes+1)};
assert.throws(()=>inspectPlusExecPayload(huge,{transport:'transfer'}),/plus_exec_batch_too_large_split_required/);

const helper=toolHelperView({context:{deviceId:'dev',sessionId:'sid',agentId:'aid',platform:'linux'}});
assert.equal(helper.batching.directPayloadBytes,6000);
assert.equal(helper.batching.maxExecScriptBytes,32*1024);
assert.equal(helper.batching.recommendedMaxSteps,8);
assert.equal(helper.batching.transferChunkBytes,3072);
assert.ok(helper.batching.rules.some(x=>x.includes('Do not split because a command may run for minutes')));
assert.ok(!('maxExecTimeoutMs' in helper.batching));
assert.ok(!helper.tools.process.when.includes('Long-running'));
assert.ok(helper.tools.process.when.includes('stdin/stdout'));
assert.ok(helper.chooseTool.some(x=>x.includes('one logical shell job')));
assert.ok(helper.tools.bridgeTransfer.recipe.length>=5);

const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const registry=new ChunkTransferRegistry({maxTransferBytes:1024*1024,maxChunkBytes:PLUS_BATCH_POLICY.recommendedTransferChunkBytes});
let captured=null;
const handlers=createPlusTransferHandlers({
  registry,
  sealOperatorPayload:payload=>({sealed:payload}),
  callOperatorJson:async(method,path,body)=>{captured={method,path,body};return {ok:true,data:{accepted:true}};}
});
const response=()=>({statusCode:200,body:null,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}});
const owner={clientSessionId:'client-plus-batch-001',agentId:'agent-plus-batch-owner-001'};
const req=(body={},id=null)=>({body,params:id?{id}:{},plusClient:owner,plusClientDeviceId:'device-plus-batch-001',plusClientDevice:{device:{nodeId:'arm'},grant:{grantId:'grant-plus-batch-001'}}});
const raw=Buffer.from(JSON.stringify(medium));
const chunkBytes=PLUS_BATCH_POLICY.recommendedTransferChunkBytes,totalChunks=Math.ceil(raw.length/chunkBytes);
let r=response();handlers.begin(req({purpose:'operator-payload',totalBytes:raw.length,totalChunks,sha256:sha(raw)}),r);
assert.equal(r.statusCode,200);const transferId=r.body.transfer.id;
for(let index=0;index<totalChunks;index++){
  const chunk=raw.subarray(index*chunkBytes,Math.min(raw.length,(index+1)*chunkBytes));
  r=response();handlers.put(req({index,data:chunk.toString('base64url'),sha256:sha(chunk)},transferId),r);assert.equal(r.statusCode,200);
}
r=response();await handlers.commit(req({},transferId),r);
assert.equal(r.statusCode,200);
assert.equal(captured.path,'/v1/device-access/execute');
assert.equal(captured.body.envelope.sealed.action,'exec_batch');
assert.equal(captured.body.envelope.sealed.script.length,8000);
assert.equal(captured.body.envelope.sealed.agentId,owner.agentId);

console.log('v10-plus-batching-direct-transfer-split=PASS');
console.log('v10-plus-batching-duration-not-split=PASS');
