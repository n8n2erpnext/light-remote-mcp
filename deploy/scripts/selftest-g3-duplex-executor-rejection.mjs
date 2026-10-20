import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {DeviceDuplexClient,DEVICE_DUPLEX_PROTOCOL} from '../../lib/device-duplex-client.mjs';
import {handleDeviceDuplexSession} from '../../operator-host/device-duplex-session.mjs';
import {FleetRouter} from '../../operator-host/fleet-router.mjs';

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const awaitCondition=async(fn,timeoutMs=4200)=>{
  const end=Date.now()+timeoutMs;
  while(Date.now()<end){if(fn())return true;await delay(40);}
  return false;
};
const id={accountId:'g3-reject-owner',deviceId:'g3-reject-device',nodeId:'g3-reject-leaf'};
const touch={...id,capabilities:['filesystem'],sessionCeiling:2};
const router=new FleetRouter({channelTtlMs:10000,commandLeaseMs:2500});
router.touch(touch);
const results=[],log=[],unhandled=[];
const unhandledListener=e=>unhandled.push(String(e?.message||e));
process.on('unhandledRejection',unhandledListener);
const server=http.createServer((req,res)=>{
  if(req.url!=='/device-channel/stream'){res.writeHead(404).end();return;}
  void handleDeviceDuplexSession(req,res,{
    authorizeHello:async frame=>({
      deviceId:id.deviceId,nodeId:id.nodeId,transportEpoch:frame.transportEpoch,
      context:{},helloAck:{},
    }),
    resume:async()=>router.resume(id.nodeId),
    poll:async(_ctx,wait)=>router.waitPoll(touch,Math.min(Number(wait)||50,100)),
    onHeartbeat:async()=>({node:router.touch(touch)}),
    onResult:async(_ctx,result)=>{
      results.push(result);
      router.complete({...id,commandId:result.commandId});
      return {accepted:true};
    },
    onLive:async()=>({}),
    waitMs:100
  }).catch(error=>{log.push({event:'server_error',error:String(error?.message||error)});try{res.destroy();}catch{}});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
let executions=0;
const client=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+server.address().port,
  hello:meta=>({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,clientSeq:meta.clientSeq}),
  onCommand:async command=>{
    executions++;
    if(command.payload?.mode==='reject')throw new Error('fixture internal executor rejection');
    return {commandId:command.commandId,status:'ok',exitCode:0,stdout:'G3_NEXT_COMMAND_OK',stderr:'',durationMs:1};
  },
  heartbeatPayload:()=>({}),
  heartbeatMs:2000,
  log:e=>log.push(e)
});
try{
  client.start();
  assert.equal(await client.waitReady(2500),true);
  router.enqueue({...id,jobId:'g3-reject-job-1',commandId:'g3-reject-cmd-1',payload:{mode:'reject'}});
  assert.equal(await awaitCondition(()=>results.length>=1),true,'executor rejection left Operator command pump waiting despite healthy heartbeat');
  assert.equal(results[0].status,'error');
  assert.equal(results[0].executionOutcome,'unknown','do not claim that rejected executor had no external effects');
  assert.equal(results[0].data?.errorCode,'executor_unhandled_rejection');
  console.log('G3_EXECUTOR_REJECTION_RETURNS_UNKNOWN_RESULT=PASS');
  router.enqueue({...id,jobId:'g3-reject-job-2',commandId:'g3-reject-cmd-2',payload:{mode:'ok'}});
  assert.equal(await awaitCondition(()=>results.length>=2),true,'second command did not execute after first rejected');
  assert.equal(results[1].status,'ok');
  assert.equal(results[1].stdout,'G3_NEXT_COMMAND_OK');
  assert.equal(executions,2);
  assert.equal(unhandled.length,0,'unobserved rejecting promise');
  assert.equal(router.view(id.nodeId).inFlightCommands,0);
  console.log('G3_FRESH_CHANNEL_EXECUTOR_RECOVERS_WITHOUT_STALL=PASS');
}finally{
  await client.close('fixture_done');
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  process.off('unhandledRejection',unhandledListener);
}
