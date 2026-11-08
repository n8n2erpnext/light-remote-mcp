import assert from 'node:assert/strict';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {ExecutorReadinessProbe} from '../../lib/executor-readiness-probe.mjs';

const probe=new ExecutorReadinessProbe({runner:async()=>true,failuresToDegrade:1});
await probe.check();
let unresolved=false;
const wall=startLocalWall({
  host:'127.0.0.1',port:0,auth:{enabled:false},
  getLocalStatus:async()=>({ok:true,enrolled:false,deviceName:'G3 isolated Agent',
    executorReady:unresolved?false:probe.status().ready,
    executorProbe:probe.status(),deviceDuplex:{executorDegraded:unresolved,ready:true},
    effectiveCapabilities:[],cloudState:'dormant',localPolicyProfile:'safe'}),
  getRemoteStatus:async()=>null,
});
try{
  await new Promise((resolve,reject)=>wall.server.listening?resolve():wall.server.once('listening',resolve).once('error',reject));
  const port=wall.server.address().port,base='http://127.0.0.1:'+port;
  const get=async path=>{
    const response=await fetch(base+path,{cache:'no-store'});
    assert.equal(response.status,200);
    return response;
  };
  let snapshot=await (await get('/api/status')).json();
  assert.equal(snapshot.local.executorReady,true);
  assert.equal(snapshot.local.executorProbe.state,'healthy');
  assert.ok((await (await get('/')).text()).includes('spawn probe '),'visible Local Wall UI should render actual probe diagnostics');
  console.log('G3_WALL_EXPOSES_RUNNING_AGENT_PROBE=PASS');

  probe.runner=async()=>false;await probe.check();
  snapshot=await (await get('/api/status')).json();
  assert.equal(snapshot.local.executorReady,false);
  assert.equal(snapshot.local.executorProbe.state,'unavailable');
  assert.equal(snapshot.local.executorProbe.consecutiveFailures,1);
  console.log('G3_WALL_EXPOSES_EXECUTOR_UNAVAILABLE=PASS');

  probe.runner=async()=>true;await probe.check();
  unresolved=true;
  snapshot=await (await get('/api/status')).json();
  assert.equal(snapshot.local.executorProbe.state,'healthy');
  assert.equal(snapshot.local.executorReady,false,'hung command must override healthy subprocess canary');
  console.log('G3_WALL_SEPARATES_CANARY_FROM_COMMAND_STALL=PASS');

  unresolved=false;
  probe.lastCheckedAt=Date.now()-probe.maxAgeMs-1;
  snapshot=await (await get('/api/status')).json();
  assert.equal(snapshot.local.executorProbe.state,'stale');
  assert.equal(snapshot.local.executorReady,false);
  console.log('G3_WALL_EXPOSES_STALE_EXECUTOR_EVIDENCE=PASS');
}finally{
  probe.stop();
  await wall.close();
}
