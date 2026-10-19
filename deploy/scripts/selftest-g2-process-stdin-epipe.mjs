import assert from 'node:assert/strict';
import os from 'node:os';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const owner={accountId:'g2',deviceId:'g2',sessionId:'g2',agentId:'g2'};
const reg=new NativeProcessRegistry();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Child closes the stdin pipe but remains alive, provoking an asynchronous
// EPIPE on the parent's next write. Before G2 patch this crashed Node.
const script="require('fs').closeSync(0);process.stdout.write('G2_READY\\n');setTimeout(()=>{},1800);";
const started=reg.start({...owner,script,cwd:os.tmpdir(),
  spawnSpec:source=>({file:process.execPath,args:['-e',source]})});
let ready=false;
for(let i=0;i<100;i++){
  if(reg.output(started.processId,owner).output.text.includes('G2_READY')){ready=true;break;}
  await sleep(10);
}
assert.equal(ready,true,'child closed stdin and remained alive');
let firstSynchronousFailure=false;
try{reg.input(started.processId,owner,{data:'g2-synthetic-nonsecret-input'});}
catch(error){assert.equal(error.message,'process_stdin_unavailable');firstSynchronousFailure=true;}
await sleep(150); // Previously unhandled EPIPE crashed here.
const row=reg.view(started.processId,owner);
assert.equal(row.stdinState==='error'||row.stdinState==='closed',true,
  'closed child stdin is reflected without process crash');
assert.equal(['EPIPE','STDIN_ERROR',null].includes(row.stdinErrorCode),true);
assert.throws(()=>reg.input(started.processId,owner,{data:'retry'}),/process_stdin_unavailable/);
assert.throws(()=>reg.input(started.processId,{...owner,agentId:'other'},{data:'again'}),/process_owner_mismatch/);
reg.stop(started.processId,owner,{force:true});
console.log('G2_PROCESS_STDIN_EPIPE_NO_AGENT_CRASH=PASS firstSyncFail='+firstSynchronousFailure);
console.log('G2_PROCESS_STDIN_CLOSED_RETRY_DENIED=PASS');
