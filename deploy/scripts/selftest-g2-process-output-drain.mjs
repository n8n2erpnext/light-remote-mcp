import assert from 'node:assert/strict';
import os from 'node:os';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

const owner={accountId:'g2fixture',deviceId:'g2fixture',sessionId:'g2fixture',agentId:'g2fixture'};
const expected=1024*1024,iterations=6;
let earlyFinish=0;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(let i=0;i<iterations;i++){
  const reg=new NativeProcessRegistry({maxProcesses:1,bufferBytes:65536});
  const child=reg.start({...owner,cwd:os.tmpdir(),
    script:'require("fs").writeSync(1,Buffer.alloc('+expected+',88));',
    spawnSpec:script=>({file:process.execPath,args:['-e',script]})});
  let atFinish=null,atClose=null;
  for(let j=0;j<1000;j++){
    const state=reg.view(child.processId,owner);
    if(state.finishedAt){atFinish=reg.output(child.processId,owner,{limit:65536}).output.totalBytes;break;}
    await sleep(2);
  }
  assert.notEqual(atFinish,null,'child should settle');
  await sleep(35);
  atClose=reg.output(child.processId,owner,{limit:65536}).output.totalBytes;
  assert.equal(atClose,expected,'all bytes should be accounted after stream close');
  if(atFinish<expected)earlyFinish++;
  console.log('G2_PROCESS_OUTPUT_DRAIN_SAMPLE_'+(i+1)+' first='+atFinish+' final='+atClose);
}
assert.equal(earlyFinish,0,'process finished before stdout drained in '+earlyFinish+'/'+iterations+' samples');
console.log('G2_PROCESS_FINISH_REQUIRES_STDOUT_DRAIN=PASS');
