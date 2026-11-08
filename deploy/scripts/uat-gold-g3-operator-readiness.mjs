import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';

// Read-only acceptance against the REAL Gold Operator IPC inside its Linux LXD.
// No enrollment, fake heartbeat, network changes, restart or business writes.
const socketPath=process.env.GOLD_G3_OPERATOR_SOCKET||'/run/light-remote-gold-uat/operator.sock';
assert.ok(fs.existsSync(socketPath),'G3_GOLD_OPERATOR_IPC_NOT_PRESENT');
const started=performance.now();
const response=await new Promise((resolve,reject)=>{
  const req=http.get({socketPath,path:'/v1/fleet',timeout:6000},res=>{
    let body='';res.setEncoding('utf8');
    res.on('data',chunk=>{body+=chunk;if(body.length>200000)req.destroy(new Error('G3_IPC_RESPONSE_OVER_LIMIT'))});
    res.on('end',()=>resolve({status:res.statusCode,body}));
    res.on('error',reject);
  });
  req.on('timeout',()=>req.destroy(new Error('G3_IPC_TIMEOUT')));
  req.on('error',reject);
});
assert.equal(response.status,200,'G3_GOLD_OPERATOR_IPC_MUST_RETURN_HTTP_200');
const payload=JSON.parse(response.body);
assert.equal(payload.ok,true);
const leaves=(payload.nodes||[]).filter(n=>Number.isInteger(n.inFlightCommands));
assert.ok(leaves.length>=1,'G3_REQUIRES_REAL_CONNECTED_LEAF_NOT_ONLY_LOCAL_HUB');
for(const node of leaves){
  assert.equal(typeof node.channelFresh,'boolean','G3_CHANNEL_FRESHNESS_MISSING');
  assert.equal(typeof node.dispatchReady,'boolean','G3_DISPATCH_READY_MISSING');
  assert.ok(['ready','draining','channel_stale'].includes(node.readinessReason),'G3_READINESS_REASON_INVALID');
  assert.equal(node.state==='online',node.channelFresh,'G3_FRESHNESS_MUST_MATCH_CHANNEL_STATUS');
  assert.equal(node.dispatchReady,node.channelFresh&&!node.draining,'G3_DISPATCH_READINESS_TUPLE_INCONSISTENT');
}
console.log('G3_GOLD_LXD_OPERATOR_LIVE_IPC=PASS latencyMs='+Math.round(performance.now()-started));
console.log('G3_GOLD_LXD_REAL_LEAF_READINESS=PASS leaves='+leaves.length);
console.log('G3_GOLD_LXD_LIVE_COUNTS='+JSON.stringify({leafCount:leaves.length,online:leaves.filter(x=>x.state==='online').length,queued:leaves.reduce((n,x)=>n+x.queuedCommands,0),inFlight:leaves.reduce((n,x)=>n+x.inFlightCommands,0)}));
