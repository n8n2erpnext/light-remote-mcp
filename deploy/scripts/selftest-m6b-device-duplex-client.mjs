import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { CommandExecutionCoordinator, DeviceDuplexClient, DEVICE_DUPLEX_PROTOCOL } from '../../lib/device-duplex-client.mjs';

const packageManifest=JSON.parse(fs.readFileSync(new URL('../../client/core-files.json',import.meta.url),'utf8'));
assert.ok(packageManifest.files.some(row=>row.source==='lib/device-duplex-client.mjs'&&row.destination==='lib/device-duplex-client.mjs'),'device_duplex_client_not_packaged');
const installHost=fs.readFileSync(new URL('./install-host.sh',import.meta.url),'utf8');
for(const lib of ['device-duplex-client.mjs','native-desktop.mjs','real-remote-policy.mjs','real-remote-input.cjs']){
  assert.ok(installHost.split(lib).length-1>=2,'install_host_missing_runtime_dependency:'+lib);
}

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,ms=4000){const d=Date.now()+ms;while(Date.now()<d){const v=fn();if(v)return v;await sleep(20);}throw new Error('wait_timeout');}
let connections=0,resultFrame=null,liveFrame=null,closeFrame=null,activeResponse=null;
const server=http.createServer((req,res)=>{
  if(req.url!=='/device-channel/stream'){res.writeHead(404);res.end();return;}
  connections++;const n=connections;activeResponse=res;let buf='';let serverSeq=0;
  const send=(type,data={})=>res.write(JSON.stringify({type,protocol:DEVICE_DUPLEX_PROTOCOL,serverEpoch:n===1?'epoch-a':'epoch-b',streamId:'s'+n,serverSeq:++serverSeq,...data})+'\n');
  res.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store'});res.flushHeaders?.();
  req.setEncoding('utf8');
  req.on('data',chunk=>{buf+=chunk;for(;;){const at=buf.indexOf('\n');if(at<0)break;const line=buf.slice(0,at);buf=buf.slice(at+1);if(!line.trim())continue;const f=JSON.parse(line);
    if(f.payload?.protocol===DEVICE_DUPLEX_PROTOCOL){send('hello-ack',{lastClientSeq:0,transportEpoch:f.payload.transportEpoch});if(n===1)setTimeout(()=>send('command',{command:{commandId:'cmd_duplex_test',payload:{kind:'selftest'}}}),30);continue;}
    if(f.type==='ack'){send('client-ack',{clientSeq:f.clientSeq,lastClientSeq:f.clientSeq});continue;}
    if(f.type==='result'){resultFrame=f;send('result-ack',{clientSeq:f.clientSeq,lastClientSeq:f.clientSeq,commandId:f.result?.commandId,accepted:true});continue;}
    if(f.type==='live'){liveFrame=f;send('live-ack',{clientSeq:f.clientSeq,lastClientSeq:f.clientSeq,stateSeq:f.payload?.stateSeq||0,inputSeq:f.payload?.inputSeq||0,rootEpoch:f.payload?.rootEpoch||0});continue;}
    if(f.type==='heartbeat'){send('heartbeat-ack',{clientSeq:f.clientSeq,lastClientSeq:f.clientSeq});continue;}
    if(f.type==='close'){closeFrame=f;send('client-ack',{clientSeq:f.clientSeq,lastClientSeq:f.clientSeq,closing:true});setTimeout(()=>res.end(),10);continue;}
  }});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
let epochChanges=0;
const duplex=new DeviceDuplexClient({
  hub:'http://127.0.0.1:'+port,
  hello:meta=>({deviceId:'dev-test',payload:{protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:meta.transportEpoch,resumeClientSeq:meta.resumeClientSeq,clientSeq:meta.clientSeq}}),
  onCommand:async command=>({commandId:command.commandId,ok:true,stdout:'done'}),
  onHelloAck:async(_frame,info)=>{if(info.serverEpochChanged)epochChanges++;},
  heartbeatPayload:()=>({agentVersion:'selftest'}),
  heartbeatMs:2000
});
duplex.start();
assert.equal(await duplex.waitReady(2000),true);
await waitFor(()=>resultFrame,3000);
assert.equal(resultFrame.result.commandId,'cmd_duplex_test');
assert.equal(resultFrame.result.ok,true);
assert.equal(await duplex.sendLive({semanticSessionId:'sem',stateSeq:7,inputSeq:3,rootEpoch:2}),true);
await waitFor(()=>liveFrame,2000);
assert.equal(liveFrame.payload.stateSeq,7);
activeResponse.destroy();
await waitFor(()=>connections>=2&&duplex.status().ready&&duplex.status().serverEpoch==='epoch-b',5000);
assert.equal(epochChanges,1);
assert.ok(duplex.status().reconnects>=1);
await duplex.close('selftest');
await waitFor(()=>closeFrame,2000);
assert.equal(closeFrame.type,'close');
assert.equal(duplex.status().active,false);
server.close();
console.log(JSON.stringify({gate:'M6B_DEVICE_DUPLEX_CLIENT',status:'PASS',connections,epochChanges,metrics:duplex.status()}));


const coordinator=new CommandExecutionCoordinator();
let coordinatedExecutions=0,releaseCoordinated;
const coordinatedGate=new Promise(resolve=>{releaseCoordinated=resolve;});
const pollOwner=coordinator.run('cmd_transport_race','poll',async()=>{coordinatedExecutions++;await coordinatedGate;return {commandId:'cmd_transport_race',status:'ok',exitCode:0};});
const duplexDuplicate=coordinator.run('cmd_transport_race','duplex',async()=>{coordinatedExecutions++;return {commandId:'cmd_transport_race',status:'wrong'};});
await waitFor(()=>coordinatedExecutions===1,1000);
releaseCoordinated();
const [ownerClaim,duplicateClaim]=await Promise.all([pollOwner,duplexDuplicate]);
assert.equal(coordinatedExecutions,1);
assert.equal(ownerClaim.owner,true);
assert.equal(ownerClaim.transport,'poll');
assert.equal(duplicateClaim.owner,false);
assert.equal(duplicateClaim.transport,'poll');
assert.deepEqual(duplicateClaim.result,ownerClaim.result);
assert.equal(coordinator.size(),0);

const suppressClient=new DeviceDuplexClient({onCommand:async()=>undefined});
suppressClient.ready=true;
await suppressClient._runCommand({commandId:'cmd_suppress_nonowner'});
assert.equal(suppressClient.status().suppressedResults,1);
assert.equal(suppressClient.status().results,0);
const operatorAgent=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
assert.ok(operatorAgent.includes("event:'device_command_duplicate_replayed'"),'duplex_duplicate_replay_event_missing');
assert.ok(operatorAgent.includes("const source=claim.result;if(!source||typeof source!=='object'||Array.isArray(source))return source;"),'duplex_duplicate_cached_result_missing');
assert.ok(!operatorAgent.includes("duplicateTransport:'duplex'}));return undefined;"),'duplex_duplicate_result_still_suppressed');
console.log('M6B_COMMAND_TRANSPORT_OWNERSHIP=PASS');
