import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const owner={accountId:'g2tcp',deviceId:'testdev',sessionId:'reconnectsession',agentId:'testagent'};
const other={...owner,agentId:'unrelated'};
const reg=new NativeProcessRegistry({stopGraceMs:100});
let startedId=null,dropped=false;
const server=http.createServer((req,res)=>{
  if(req.url==='/start'){
    const script="console.log('G2_REMOTE_JOB_ALIVE');setInterval(()=>{},1000)";
    const task=reg.start({...owner,cwd:os.tmpdir(),script,timeoutMs:12000,spawnSpec:code=>({file:process.execPath,args:['-e',code]})});
    startedId=task.processId;
    // Partial reply then client network socket disappears before ACK completes.
    res.writeHead(200,{'content-type':'application/json'});
    res.write('{"processId":"');
    setTimeout(()=>{if(!res.destroyed)res.end(startedId+'"}');},250).unref?.();
    return;
  }
  if(req.url==='/status'){
    const status=reg.view(startedId,owner);
    res.writeHead(200,{'content-type':'application/json'});
    res.end(JSON.stringify({state:status.state,processId:status.processId}));
    return;
  }
  res.writeHead(404);res.end();
});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  await new Promise((resolve,reject)=>server.listen(0,'127.0.0.1',resolve).once('error',reject));
  const port=server.address().port;
  await new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port,path:'/start'},res=>{
      res.once('data',()=>{dropped=true;res.destroy();req.destroy();resolve();});
      res.once('error',error=>{if(dropped)resolve();else reject(error);});
    });
    req.on('error',error=>{if(dropped)resolve();else reject(error);});
  });
  assert.ok(dropped&&startedId,'a real TCP response must be abandoned after process admission');
  const warmDeadline=Date.now()+8000;
  while(Date.now()<warmDeadline&&!reg.output(startedId,owner,{stream:'stdout',limit:300}).output.text.includes('G2_REMOTE_JOB_ALIVE'))await wait(40);
  assert.match(reg.output(startedId,owner,{stream:'stdout',limit:300}).output.text,/G2_REMOTE_JOB_ALIVE/,'real child must start even after lost HTTP response');
  const recovered=await new Promise((resolve,reject)=>{
    http.get({host:'127.0.0.1',port,path:'/status'},res=>{
      let body='';res.on('data',d=>body+=d);res.on('end',()=>resolve(JSON.parse(body)));res.on('error',reject);
    }).on('error',reject);
  });
  assert.equal(recovered.processId,startedId);
  assert.equal(recovered.state,'running');
  assert.throws(()=>reg.view(startedId,other),/process_owner_mismatch/);
  assert.match(reg.output(startedId,owner,{stream:'stdout',limit:300}).output.text,/G2_REMOTE_JOB_ALIVE/);
  console.log('G2_TCP_ABORT_AFTER_DISPATCH_JOB_SURVIVES=PASS');
  console.log('G2_TCP_RECONNECT_OWNER_STATE_AND_OUTPUT=PASS');
  const stopped=reg.stop(startedId,owner,{force:false});
  assert.equal(stopped.stopRequested,true);
  const end=Date.now()+5000;
  let last=null;
  while(Date.now()<end){last=reg.view(startedId,owner);if(last.finishedAt)break;await wait(25);}
  assert.ok(last?.finishedAt,'after reconnect the same job must stop and release its active slot');
  assert.equal(reg.list(owner).filter(p=>!p.finishedAt).length,0);
  console.log('G2_TCP_RECONNECT_CANCEL_AND_CLEANUP=PASS');
}finally{
  reg.close();
  await new Promise(resolve=>server.close(resolve));
}
