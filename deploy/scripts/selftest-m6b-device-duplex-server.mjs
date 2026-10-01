import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { handleDeviceDuplexSession } from '../../operator-host/device-duplex-session.mjs';
import { DEVICE_DUPLEX_PROTOCOL } from '../../operator-host/device-duplex-transport.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,ms=3000){const d=Date.now()+ms;while(Date.now()<d){const v=fn();if(v)return v;await sleep(10);}throw new Error('wait_timeout');}
class FakeResponse extends PassThrough{
  constructor(){super();this.headersSent=false;this.statusCode=0;this.socket={setNoDelay(){},setKeepAlive(){}};}
  writeHead(code,headers){this.statusCode=code;this.headersSent=true;this.headers=headers;return this;}
  flushHeaders(){}
}
async function runSession(epoch,frames=[]){
  const req=new PassThrough(),res=new FakeResponse();let out='',resumes=0;
  res.setEncoding('utf8');res.on('data',c=>out+=c);
  const promise=handleDeviceDuplexSession(req,res,{
    authorizeHello:async hello=>({deviceId:'dev1',nodeId:'node1',transportEpoch:hello.transportEpoch,helloAck:{probe:true}}),
    resume:async()=>{resumes++;},
    poll:async()=>{await sleep(15);return {state:'idle',node:{draining:false},command:null};},
    onResult:async()=>({accepted:true}),onLive:async()=>({live:{stateSeq:4,inputSeq:2,rootEpoch:1}}),
    onHeartbeat:async()=>({policy:null}),waitMs:20
  });
  req.write(JSON.stringify({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:epoch})+'\n');
  await waitFor(()=>out.includes('"hello-ack"'));
  for(const frame of frames){req.write(JSON.stringify({...frame,transportEpoch:epoch})+'\n');await sleep(30);}
  return {req,res,promise,get out(){return out;},resumes};
}
const a=await runSession('epoch-x');
a.req.write(JSON.stringify({type:'heartbeat',clientSeq:1,transportEpoch:'epoch-x',payload:{}})+'\n');
await waitFor(()=>a.out.includes('"heartbeat-ack"'));
a.req.write(JSON.stringify({type:'heartbeat',clientSeq:1,transportEpoch:'epoch-x',payload:{}})+'\n');
await waitFor(()=>a.out.includes('"duplicate":true'));
a.req.write(JSON.stringify({type:'heartbeat',clientSeq:3,transportEpoch:'epoch-x',payload:{}})+'\n');
await waitFor(()=>a.out.includes('"needReplay":true'));
a.req.write(JSON.stringify({type:'close',clientSeq:2,transportEpoch:'epoch-x'})+'\n');
await a.promise;
assert.equal(a.res.statusCode,200);
assert.equal(a.resumes,1);
const firstLines=a.out.trim().split(/\n+/).map(JSON.parse);
assert.ok(firstLines.some(x=>x.type==='heartbeat-ack'&&x.lastClientSeq===1));
assert.ok(firstLines.some(x=>x.type==='client-ack'&&x.duplicate===true));
assert.ok(firstLines.some(x=>x.type==='client-ack'&&x.needReplay===true));

const b=await runSession('epoch-x');
await waitFor(()=>b.out.includes('"hello-ack"'));
const hello2=b.out.trim().split(/\n+/).map(JSON.parse).find(x=>x.type==='hello-ack');
assert.equal(hello2.lastClientSeq,2);
b.req.write(JSON.stringify({type:'close',clientSeq:3,transportEpoch:'epoch-x'})+'\n');
await b.promise;
let commandResult=null,served=false;
const req3=new PassThrough(),res3=new FakeResponse();let out3='';
res3.setEncoding('utf8');res3.on('data',c=>out3+=c);
const p3=handleDeviceDuplexSession(req3,res3,{
  authorizeHello:async hello=>({deviceId:'dev-cmd',nodeId:'node-cmd',transportEpoch:hello.transportEpoch,helloAck:{}}),
  resume:async()=>{},
  poll:async()=>{if(!served){served=true;return {state:'command',node:{draining:false},command:{commandId:'cmd_server_stream',payload:{kind:'selftest'}}};}await sleep(15);return {state:'idle',node:{draining:false},command:null};},
  onResult:async(_auth,result)=>{commandResult=result;return {accepted:true};},
  onLive:async()=>({live:{stateSeq:0,inputSeq:0,rootEpoch:0}}),onHeartbeat:async()=>({}),waitMs:20
});
req3.write(JSON.stringify({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:'epoch-cmd'})+'\n');
await waitFor(()=>out3.includes('"command"'));
let lines3=out3.trim().split(/\n+/).map(JSON.parse),hello3=lines3.find(x=>x.type==='hello-ack'),cmd3=lines3.find(x=>x.type==='command');
assert.equal(cmd3.command.commandId,'cmd_server_stream');
req3.write(JSON.stringify({type:'ack',clientSeq:1,serverSeq:hello3.serverSeq,transportEpoch:'epoch-cmd'})+'\n');
await sleep(20);
req3.write(JSON.stringify({type:'ack',clientSeq:2,serverSeq:cmd3.serverSeq,transportEpoch:'epoch-cmd'})+'\n');
await sleep(20);
req3.write(JSON.stringify({type:'result',clientSeq:3,transportEpoch:'epoch-cmd',result:{commandId:'cmd_server_stream',status:'ok',exitCode:0}})+'\n');
await waitFor(()=>commandResult?.commandId==='cmd_server_stream');
await waitFor(()=>out3.includes('"result-ack"'));
req3.write(JSON.stringify({type:'close',clientSeq:4,transportEpoch:'epoch-cmd'})+'\n');
await p3;
assert.equal(commandResult.status,'ok');

console.log(JSON.stringify({gate:'M6B_DEVICE_DUPLEX_SERVER',status:'PASS',resumeLastClientSeq:hello2.lastClientSeq,commandResult:commandResult.commandId}));
