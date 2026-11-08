import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {registerPluginTools} from '../../plugin-server/tools.mjs';
import {AccountOperatorAdapter} from '../../plugin-server/operator-adapter.mjs';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function setup(){
  const callbacks=new Map();
  const definitions=new Map();
  const server={registerTool(name,def,fn){
    if(callbacks.has(name))throw Error('duplicate_tool');
    definitions.set(name,def);callbacks.set(name,fn);
  }};
  // No actual network, OAuth provider, devices or real Operator called.
  const identity={accountId:'uat_scp_account',clientId:'uat_scp_client',
    scope:'remote:read remote:write',
    scopes:['remote:read','remote:write']};
  registerPluginTools(server,identity);
  return {callbacks,definitions};
}
test('registered public MCP upload-chunk callback has optional SHA schema',()=>{
  const {definitions}=setup();
  const schema=definitions.get('light_remote_scp_upload_chunk').inputSchema;
  // MCP SDK registerTool accepts a shape of Zod fields, not a z.object.
  assert.ok(schema&&typeof schema.sha256?.safeParse==='function');
  assert.equal(schema.sha256.safeParse(undefined).success,true);
  assert.equal(schema.sha256.safeParse(sha(Buffer.from('hello'))).success,true);
  assert.equal(schema.sha256.safeParse('invalid').success,false);
});
test('actual registered MCP callback forwards a computed SHA to next Operator boundary',async()=>{
  const {callbacks}=setup();
  const callback=callbacks.get('light_remote_scp_upload_chunk');
  assert.equal(typeof callback,'function');
  const original=AccountOperatorAdapter.prototype.scp;
  const messages=[];
  AccountOperatorAdapter.prototype.scp=async function(sessionId,scp,operationId){
    messages.push({sessionId,scp,operationId});
    return {ok:true,data:{ok:true,operation:'upload-chunk',transfer: {
      receivedBytes:5,complete:true}},job:{jobId:'uat_job',state:'ok',
        finishedAt:Date.now(),exitCode:0}};
  };
  try{
    const output=await callback({sessionId:'uat_session',transferId:'lscp_good',
      index:0,data:'aGVsbG8',operationId:'uat_operation_1234567890'});
    assert.equal(output.isError,undefined,
      JSON.stringify(output).slice(0,280));
    assert.equal(messages.length,1,'must reach next mock boundary exactly once');
    assert.deepEqual(messages[0].scp,{
      op:'upload-chunk',transferId:'lscp_good',index:0,
      data:'aGVsbG8',sha256:sha(Buffer.from('hello'))});
    assert.equal(messages[0].sessionId,'uat_session');
    assert.equal(messages[0].operationId,'uat_operation_1234567890');
  }finally{
    AccountOperatorAdapter.prototype.scp=original;
  }
});
test('real MCP callback rejects bad hash before calling remote operator',async()=>{
  const {callbacks}=setup();
  const callback=callbacks.get('light_remote_scp_upload_chunk');
  let calls=0;
  const original=AccountOperatorAdapter.prototype.scp;
  AccountOperatorAdapter.prototype.scp=async()=>{calls++;throw Error('unreachable');};
  try{
    const output=await callback({sessionId:'uat_session',transferId:'lscp_good',
      index:0,data:'aGVsbG8',sha256:'f'.repeat(64)});
    assert.equal(calls,0);
    assert.equal(output.isError,true);
    assert.match(output.content[0].text,/scp_chunk_hash_mismatch/);
  }finally{AccountOperatorAdapter.prototype.scp=original;}
});

// This executes actual registered MCP tool callbacks and the actual
// LightScpRegistry/file IO, with ONLY the cross-service Operator seam mocked.
// The installed production remote Agent is never invoked or restarted.
test('MCP registered begin/chunk/commit makes byte-identical 3-chunk file through leaf registry',async()=>{
  const {LightScpRegistry}=await import('../../lib/light-scp-registry.mjs');
  const fs=await import('node:fs');
  const os=await import('node:os');
  const path=await import('node:path');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr50-mcp-registry-'));
  const registry=new LightScpRegistry({policy:{readRoots:[dir],writeRoots:[dir],
    downloadRoots:[dir],uploadRoots:[dir]}});
  const owner={accountId:'owner_mcp_uat',deviceId:'device_mcp_uat',
    sessionId:'uat_session',agentId:'agent_mcp_uat'};
  const saved=AccountOperatorAdapter.prototype.scp;
  let callCount=0;
  AccountOperatorAdapter.prototype.scp=async function(sessionId,scp){
    assert.equal(sessionId,'uat_session');
    callCount++;
    let data;
    switch(scp.op){
      case 'upload-begin':
        data={ok:true,operation:scp.op,transfer:await registry.beginUpload(owner,scp)};
        break;
      case 'upload-chunk':
        assert.match(scp.sha256,/^[0-9a-f]{64}$/);
        data={ok:true,operation:scp.op,
          transfer:await registry.putUploadChunk(owner,scp.transferId,scp)};
        break;
      case 'upload-commit':
        data={ok:true,operation:scp.op,
          result:await registry.commitUpload(owner,scp.transferId)};
        break;
      default:throw Error('unexpected_scp_operation');
    }
    return {ok:true,data,job:{jobId:'uat_job_123',status:'ok',
      finishedAt:Date.now(),exitCode:0}};
  };
  const {callbacks}=setup();
  const bytes=crypto.randomBytes(140_011), dest=path.join(dir,'sealed-binary.bin');
  const input={sessionId:'uat_session'};
  const unwrap=x=>{
    assert.equal(x.isError,undefined,JSON.stringify(x).slice(0,400));
    const result=JSON.parse(x.content[0].text);
    assert.equal(result.ok,true);
    return result.data;
  };
  try{
    const begin=unwrap(await callbacks.get('light_remote_scp')({...input,
      destination:dest,totalBytes:bytes.length,
      sha256:sha(bytes),chunkBytes:65536}));
    const transferId=begin.transfer.id;
    for(let index=0;index<3;index++){
      const part=bytes.subarray(index*65536,(index+1)*65536);
      const response=unwrap(await callbacks.get('light_remote_scp_upload_chunk')({
        ...input,transferId,index,data:part.toString('base64url')}));
      assert.equal(response.transfer.receivedChunks,index+1);
    }
    const finish=unwrap(await callbacks.get('light_remote_scp_upload_commit')({
      ...input,transferId}));
    assert.equal(finish.result.sha256,sha(bytes));
    assert.equal(fs.readFileSync(dest).compare(bytes),0);
    assert.equal(callCount,5);
  }finally{
    AccountOperatorAdapter.prototype.scp=saved;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
