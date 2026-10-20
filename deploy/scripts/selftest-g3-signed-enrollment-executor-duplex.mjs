import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import {once} from 'node:events';
import {EnrollmentRegistry,EnrollmentError} from '../../operator-host/enrollment-registry.mjs';
import {FleetRouter,FleetError} from '../../operator-host/fleet-router.mjs';
import {handleDeviceDuplexSession} from '../../operator-host/device-duplex-session.mjs';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';
import {ExecutorReadinessProbe} from '../../lib/executor-readiness-probe.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,timeoutMs=6500)=>{const end=Date.now()+timeoutMs;while(Date.now()<end){if(check())return true;await sleep(35);}return false;};
const ownerId='g3-isolated-test-owner';
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const enrollment=new EnrollmentRegistry({activationBaseUrl:'https://test.invalid/enroll'});
const begun=enrollment.begin({publicIdentityKey,displayName:'Gold-G3-Synthetic-Agent',platform:process.platform,
  architecture:process.arch,capabilities:['filesystem'],policyProfile:'safe',sourceHash:'isolated-loopback'});
assert.equal(enrollment.listPending().length,1);
assert.equal(enrollment.poll({enrollmentId:begun.enrollmentId,pollToken:begun.pollToken}).state,'pending');
assert.throws(()=>enrollment.approve({enrollmentId:begun.enrollmentId,code:'WRONG-123',accountId:ownerId}),
  error=>error instanceof EnrollmentError,'bad approval code must fail');
const approval=enrollment.approve({enrollmentId:begun.enrollmentId,code:begun.deviceCode,accountId:ownerId,approvedCapabilities:['filesystem']});
const claimed=enrollment.poll({enrollmentId:begun.enrollmentId,pollToken:begun.pollToken});
assert.equal(claimed.state,'approved');
assert.equal(claimed.deviceId,approval.deviceId);
assert.equal(claimed.accountId,ownerId);
assert.throws(()=>enrollment.approve({enrollmentId:begun.enrollmentId,code:begun.deviceCode,accountId:ownerId}),
  error=>error instanceof EnrollmentError,'approval must be one-time');
console.log('G3_EPHEMERAL_ENROLLMENT_APPROVAL_CLAIM=PASS');

let nonceSerial=0;
const sign=(action,payload)=>{
  const timestamp=Date.now();
  const nonce=crypto.randomBytes(16).toString('base64url')+'_'+(++nonceSerial);
  const message=deviceChannelMessage({deviceId:claimed.deviceId,action,timestamp,nonce,payload});
  const signature=crypto.sign(null,Buffer.from(message),privateKey).toString('base64url');
  return {deviceId:claimed.deviceId,timestamp,nonce,signature,payload};
};
const probe=new ExecutorReadinessProbe({runner:async()=>true,failuresToDegrade:2});
assert.equal((await probe.check()).ready,true);
const node={accountId:ownerId,deviceId:claimed.deviceId,nodeId:claimed.deviceId};
const fleet=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2200});
const events=[],results=[],execution=[];
const sockets=new Set();
const server=http.createServer((req,res)=>{
  if(req.url!=='/device-channel/stream'){res.writeHead(404).end();return;}
  sockets.add(res);res.once('close',()=>sockets.delete(res));
  void handleDeviceDuplexSession(req,res,{
    authorizeHello:async frame=>{
      const verified=enrollment.verifyChannel(frame,'stream',frame.payload);
      assert.equal(verified.binding.deviceId,claimed.deviceId);
      const payload=frame.payload;
      assert.equal(payload.protocol,DEVICE_DUPLEX_PROTOCOL);
      assert.equal(payload.nodeId,claimed.deviceId);
      const input={...node,sessionCeiling:1,capabilities:payload.capabilities,executorReady:payload.executorReady};
      fleet.touch(input);
      return {deviceId:node.deviceId,nodeId:node.nodeId,transportEpoch:payload.transportEpoch,
        context:{touchInput:input},helloAck:{node:fleet.view(node.nodeId)}};
    },
    resume:async()=>fleet.resume(node.nodeId),
    poll:async(ctx,wait,stopped)=>fleet.waitPoll(()=>ctx.context.touchInput,Math.min(Number(wait)||80,100),stopped),
    onHeartbeat:async(ctx,payload)=>{
      ctx.context.touchInput={...node,sessionCeiling:1,capabilities:['filesystem'],executorReady:payload.executorReady};
      return {node:fleet.touch(ctx.context.touchInput)};
    },
    onResult:async(_ctx,result)=>{results.push(result);fleet.complete({...node,commandId:result.commandId});return {accepted:true};},
    waitMs:100,
  }).catch(error=>{events.push({event:'rejected_stream',error:String(error.message||error)});try{res.destroy();}catch{}});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let client;
client=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+server.address().port,
  hello:meta=>{
    const payload={protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,
      clientSeq:meta.clientSeq,resumeClientSeq:meta.resumeClientSeq,nodeId:node.nodeId,
      agentVersion:'g3-ephemeral-fixture',sessionCeiling:1,capabilities:['filesystem'],executorReady:probe.status().ready};
    return {type:'hello',...sign('stream',payload)};
  },
  heartbeatPayload:()=>({nodeId:node.nodeId,capabilities:['filesystem'],executorReady:probe.status().ready}),
  onCommand:async command=>{
    execution.push(command.commandId);
    return {commandId:command.commandId,status:'ok',exitCode:0,stdout:'SIGNED_G3_OK',stderr:''};
  },
  heartbeatMs:2000,
  log:message=>events.push(message),
});
try{
  client.start();assert.equal(await client.waitReady(2500),true,'authenticated signed duplex did not become ready');
  assert.equal(fleet.view(node.nodeId).executorReady,true);
  fleet.enqueue({...node,commandId:'g3-signed-1',jobId:'g3-signed-1',payload:{mode:'safe'}});
  assert.equal(await until(()=>results.length===1),true);
  assert.deepEqual(execution,['g3-signed-1']);
  assert.equal(results[0].stdout,'SIGNED_G3_OK');
  console.log('G3_SIGNED_DUPLEX_DISPATCH_RESULT=PASS');

  const badPayload={protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:'dte_bad',nodeId:node.nodeId,executorReady:true};
  const valid=sign('stream',badPayload);
  assert.throws(()=>enrollment.verifyChannel({...valid,payload:{...badPayload,executorReady:false}},'stream',{...badPayload,executorReady:false}),
    e=>e instanceof EnrollmentError&&e.message==='invalid_device_proof');
  enrollment.verifyChannel(valid,'stream',valid.payload);
  assert.throws(()=>enrollment.verifyChannel(valid,'stream',valid.payload),
    e=>e instanceof EnrollmentError&&e.message==='device_proof_replay');
  console.log('G3_SIGNED_CHANNEL_TAMPER_AND_NONCE_REPLAY_DENIED=PASS');

  probe.runner=async()=>false;
  await probe.check();await probe.check();
  assert.equal(probe.status().ready,false);
  assert.equal(await client.sendHeartbeat({executorReady:false}),true);
  assert.equal(await until(()=>fleet.view(node.nodeId).executorReady===false),true);
  assert.equal(fleet.view(node.nodeId).channelFresh,true);
  assert.throws(()=>fleet.enqueue({...node,jobId:'g3-denied'}),e=>e instanceof FleetError&&e.message==='target_node_executor_unavailable');
  console.log('G3_SIGNED_AGENT_HEALTHY_CHANNEL_DEGRADED_EXECUTOR_BLOCK=PASS');

  probe.runner=async()=>true;
  await probe.check();
  assert.equal(await client.sendHeartbeat({executorReady:true}),true);
  assert.equal(await until(()=>fleet.view(node.nodeId).dispatchReady),true);
  fleet.enqueue({...node,commandId:'g3-signed-2',jobId:'g3-signed-2',payload:{mode:'safe'}});
  assert.equal(await until(()=>results.length===2),true);
  assert.deepEqual(execution,['g3-signed-1','g3-signed-2']);
  console.log('G3_SIGNED_EXECUTOR_RECOVERY_NO_DUPLICATE=PASS');

  const previousConnects=client.status().connects;
  for(const response of [...sockets])response.destroy(new Error('g3_signed_tcp_fault'));
  assert.equal(await until(()=>client.status().connects>previousConnects&&client.status().ready,6500),true,
    'signed Agent should reconnect with a fresh nonce');
  assert.equal(fleet.view(node.nodeId).dispatchReady,true);
  fleet.enqueue({...node,commandId:'g3-signed-3',jobId:'g3-signed-3',payload:{mode:'safe'}});
  assert.equal(await until(()=>results.length===3),true);
  assert.deepEqual(execution,['g3-signed-1','g3-signed-2','g3-signed-3']);
  console.log('G3_SIGNED_AGENT_RECONNECT_NEW_PROOF_NO_DUPLICATE=PASS');
}finally{
  await client.close('fixture_done');
  probe.stop();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
