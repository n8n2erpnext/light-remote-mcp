import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';
import {handleDeviceDuplexSession} from '../../operator-host/device-duplex-session.mjs';
import {FleetRouter,FleetError} from '../../operator-host/fleet-router.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,timeoutMs=10500){
  for(const deadline=Date.now()+timeoutMs;Date.now()<deadline;){
    if(check())return true;
    await sleep(40);
  }
  return false;
}
const owner={accountId:'g3-reconnect-owner',deviceId:'g3-reconnect-device',nodeId:'g3-reconnect-node'};
const touchBase={...owner,capabilities:['filesystem'],sessionCeiling:2};
const readinessEvents=[];
const fleet=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2100,emit:event=>{if(event.type==='node_executor_readiness_changed')readinessEvents.push(event);}});
fleet.touch({...touchBase,executorReady:true});
const sockets=new Set(),errors=[],results=[],attempts=[];
let accepted=0,resolveHeld,client;
const server=http.createServer((req,res)=>{
  if(req.url!=='/device-channel/stream'){res.writeHead(404).end();return;}
  const serial=++accepted;
  sockets.add(res);
  res.once('close',()=>sockets.delete(res));
  void handleDeviceDuplexSession(req,res,{
    authorizeHello:async frame=>{
      const input={...touchBase,executorReady:frame.executorReady};
      return {deviceId:owner.deviceId,nodeId:owner.nodeId,transportEpoch:frame.transportEpoch,context:{touchInput:input},helloAck:{}};
    },
    resume:async()=>fleet.resume(owner.nodeId),
    poll:async(ctx,wait,shouldStop)=>fleet.waitPoll(()=>ctx.context.touchInput,Math.min(Number(wait)||60,80),shouldStop),
    onHeartbeat:async(ctx,payload)=>{
      ctx.context.touchInput={...touchBase,executorReady:payload.executorReady};
      return {node:fleet.touch(ctx.context.touchInput)};
    },
    onResult:async(_ctx,result)=>{
      results.push(result);
      fleet.complete({...owner,commandId:result.commandId});
      return {accepted:true};
    },
    onLive:async()=>({}),
    waitMs:70,
  }).catch(error=>{
    errors.push({event:'server_failure',serial,error:String(error.message||error)});
    try{res.destroy();}catch{}
  });
});
server.listen(0,'127.0.0.1');await once(server,'listening');
client=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+server.address().port,
  hello:meta=>({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,clientSeq:meta.clientSeq,executorReady:!client.status().executorDegraded}),
  heartbeatPayload:()=>({executorReady:!client.status().executorDegraded}),
  heartbeatMs:2000,
  executionStaleMs:1200,
  onCommand:async command=>{
    attempts.push(command.commandId);
    if(command.payload?.mode==='hold'){
      return new Promise(resolve=>{resolveHeld=()=>resolve({commandId:command.commandId,status:'ok',exitCode:0,stdout:'LATE_ONCE_OK',stderr:''});});
    }
    return {commandId:command.commandId,status:'ok',exitCode:0,stdout:'FOLLOWUP_OK',stderr:''};
  },
  log:event=>errors.push(event),
});
try{
  client.start();
  assert.equal(await client.waitReady(2600),true);
  fleet.enqueue({...owner,jobId:'g3-reconnect-hold-job',commandId:'g3-reconnect-hold-cmd',payload:{mode:'hold'}});
  assert.equal(await until(()=>attempts.length===1&&typeof resolveHeld==='function'),true);
  assert.equal(await until(()=>client.status().executorDegraded&&fleet.view(owner.nodeId).readinessReason==='executor_unavailable'),true);
  assert.equal(fleet.view(owner.nodeId).channelFresh,true);
  assert.equal(fleet.view(owner.nodeId).inFlightCommands,1);
  assert.equal(results.length,0);
  for(const res of [...sockets])res.destroy(new Error('test_controlled_transport_drop'));
  assert.equal(await until(()=>accepted>=2&&client.status().ready),true,'client must reconnect after controlled TCP drop');
  assert.equal(await until(()=>fleet.view(owner.nodeId).executorReady===false),true);
  assert.equal(fleet.view(owner.nodeId).dispatchReady,false);
  assert.equal(readinessEvents.filter(e=>e.status==='degraded').length,1,'repeated heartbeats must not spam readiness events');
  assert.throws(()=>fleet.enqueue({...owner,jobId:'g3-reconnect-blocked',payload:{}}),e=>e instanceof FleetError&&e.message==='target_node_executor_unavailable');
  await sleep(2700); // over lease: must not dispatch again on reconnect while executor busy
  assert.deepEqual(attempts,['g3-reconnect-hold-cmd'],'an in-flight command cannot be executed twice');
  assert.equal(results.length,0,'no fabricated result after transport disruption');
  console.log('G3_TRANSPORT_DROP_RECONNECT_WITH_HELD_EXECUTOR=PASS');
  console.log('G3_NO_REPLAY_OR_FALSE_FINISH_WHEN_RECONNECT=PASS');
  resolveHeld();
  assert.equal(await until(()=>results.length===1&&fleet.view(owner.nodeId).dispatchReady),true,'late result must settle across a new stream');
  assert.equal(results[0].stdout,'LATE_ONCE_OK');
  assert.equal(readinessEvents.filter(e=>e.status==='ready').length,1,'recovery readiness must emit exactly one event: '+JSON.stringify(readinessEvents.map(e=>e.status)));
  assert.ok(readinessEvents.every(e=>!('script' in e)&&!('payload' in e)),'audit cannot leak command content');
  assert.equal(fleet.view(owner.nodeId).inFlightCommands,0);
  fleet.enqueue({...owner,jobId:'g3-reconnect-followup-job',commandId:'g3-reconnect-followup-cmd',payload:{mode:'normal'}});
  assert.equal(await until(()=>results.length===2),true);
  assert.equal(results[1].stdout,'FOLLOWUP_OK');
  assert.deepEqual(attempts,['g3-reconnect-hold-cmd','g3-reconnect-followup-cmd']);
  console.log('G3_LATE_RESULT_RESUMES_DISPATCH_AFTER_RECONNECT=PASS');
} finally {
  if(resolveHeld)resolveHeld();
  await client.close('fixture_done');
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
