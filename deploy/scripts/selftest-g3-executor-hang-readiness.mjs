import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';
import {handleDeviceDuplexSession} from '../../operator-host/device-duplex-session.mjs';
import {FleetRouter,FleetError} from '../../operator-host/fleet-router.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,ms=6500)=>{for(const stop=Date.now()+ms;Date.now()<stop;){if(check())return true;await sleep(35);}return false;};
const owner={accountId:'g3-hang-owner',deviceId:'g3-hang-device',nodeId:'g3-hang-node'};
const base={...owner,capabilities:['filesystem'],sessionCeiling:2};
const router=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2500});
router.touch(base);
let resolveHeld,executions=0,heartbeats=0;
const results=[],events=[];
const server=http.createServer((req,res)=>{
  if(req.url!=='/device-channel/stream'){res.writeHead(404).end();return;}
  void handleDeviceDuplexSession(req,res,{
    authorizeHello:async f=>({deviceId:owner.deviceId,nodeId:owner.nodeId,transportEpoch:f.transportEpoch,context:{touchInput:{...base,executorReady:f.executorReady}},helloAck:{}}),
    resume:async()=>router.resume(owner.nodeId),
    poll:async(ctx,wait)=>router.waitPoll(ctx.context.touchInput,Math.min(Number(wait)||80,100)),
    onHeartbeat:async(ctx,payload)=>{heartbeats++;ctx.context.touchInput={...base,executorReady:payload.executorReady};return {node:router.touch(ctx.context.touchInput)};},
    onResult:async(_ctx,result)=>{results.push(result);router.complete({...owner,commandId:result.commandId});return {accepted:true};},
    waitMs:100
  }).catch(e=>{events.push({event:'server_error',error:String(e)});try{res.destroy();}catch{}});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let client;
client=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+server.address().port,
  hello:meta=>({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,clientSeq:meta.clientSeq,executorReady:!client.status().executorDegraded}),
  heartbeatPayload:()=>({executorReady:!client.status().executorDegraded}),
  heartbeatMs:2000,executionStaleMs:1400,
  onCommand:async cmd=>{
    executions++;
    if(cmd.payload?.mode==='hang')return new Promise(resolve=>{resolveHeld=()=>resolve({commandId:cmd.commandId,status:'ok',exitCode:0,stdout:'HANG_RESOLVED',stderr:''});});
    await sleep(350);
    return {commandId:cmd.commandId,status:'ok',exitCode:0,stdout:'NORMAL_OK',stderr:''};
  },
  log:e=>events.push(e)
});
try{
  const defaultClient=new DeviceDuplexClient({hub:'http://127.0.0.1'});
  assert.equal(defaultClient._executionDeadline({payload:{type:'exec',timeoutMs:7200000}}),7220000);
  assert.equal(defaultClient._executionDeadline({payload:{type:'exec',timeoutMs:120000}}),140000);
  client.start();assert.equal(await client.waitReady(2200),true);
  assert.equal(await until(()=>router.list().length===1),true);
  router.enqueue({...owner,commandId:'g3-hang-cmd',jobId:'g3-hang-job',payload:{mode:'hang'}});
  assert.equal(await until(()=>executions===1&&typeof resolveHeld==='function'),true);
  assert.equal(await until(()=>client.status().executorDegraded===true),true,'unsettled execution needs bounded degraded evidence');
  assert.equal(await until(()=>router.view(owner.nodeId).readinessReason==='executor_unavailable'),true,'fresh heartbeat must surface executor unavailability');
  const view=router.view(owner.nodeId);
  assert.equal(view.channelFresh,true);
  assert.equal(view.executorReady,false);
  assert.equal(view.dispatchReady,false);
  assert.equal(view.inFlightCommands,1);
  assert.equal(results.length,0,'must not fabricate completion or unknown shell effect');
  assert.throws(()=>router.enqueue({...owner,jobId:'g3-new-job',payload:{}}),e=>e instanceof FleetError&&e.message==='target_node_executor_unavailable');
  assert.equal(view.queuedCommands,0,'denied job never gets into queue');
  router.touch(base); // older fallback poll without executorReady must not erase explicit fail-closed evidence
  assert.equal(router.view(owner.nodeId).executorReady,false);
  assert.equal(router.view(owner.nodeId).dispatchReady,false);
  await sleep(2750); // exceed command lease: heartbeat must not redeliver while degraded
  assert.equal(executions,1,'do not execute same command twice after lease expiry');
  assert.equal(results.length,0);
  assert.ok(heartbeats>0);
  console.log('G3_HUNG_EXECUTOR_FRESH_CHANNEL_ADMISSION_DENIED=PASS');
  console.log('G3_UNCERTAIN_EFFECT_NOT_REPLAYED_OR_FAKE_COMPLETED=PASS');
  resolveHeld();
  assert.equal(await until(()=>results.length===1&&router.view(owner.nodeId).executorReady===true),true,'late completion must recover readiness');
  assert.equal(results[0].stdout,'HANG_RESOLVED');
  assert.equal(router.view(owner.nodeId).inFlightCommands,0);
  router.enqueue({...owner,commandId:'g3-next-cmd',jobId:'g3-next-job',payload:{mode:'ok'}});
  assert.equal(await until(()=>results.length===2),true);
  assert.equal(results[1].stdout,'NORMAL_OK');
  assert.equal(executions,2);
  console.log('G3_LATE_EXECUTOR_COMPLETION_RECOVERS_WITHOUT_DUPLICATE=PASS');
}finally{
  await client.close('fixture_done');
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
