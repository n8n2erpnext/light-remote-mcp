import assert from 'node:assert/strict';
import { NativeProcessRegistry } from '../../lib/native-process.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const owner={accountId:'acct-test',deviceId:'dev-test',sessionId:'session-process-0001',agentId:'agent-process-test-0001'};
const reg=new NativeProcessRegistry({maxProcesses:4,bufferBytes:65536});
const spawnSpec=script=>({file:'/bin/bash',args:['-lc',script]});

const startedAt=Date.now();
let p=reg.start({...owner,script:'read x; echo got:$x; sleep 0.05; echo done',cwd:'/tmp',spawnSpec});
assert.ok(p.processId.startsWith('lp_'));
assert.equal(p.state,'running');
assert.ok(Date.now()-startedAt<500,'start should return before process completion');
reg.input(p.processId,owner,{data:'hello\n'});
let out=null,settled=null;
for(let i=0;i<80;i++){
  out=reg.output(p.processId,owner,{stream:'stdout',offset:0,limit:4096});
  settled=reg.view(p.processId,owner);
  if(/got:hello/.test(out.output.text)&&/done/.test(out.output.text)&&settled.state!=='running')break;
  await wait(25);
}
assert.match(out.output.text,/got:hello/);
assert.match(out.output.text,/done/);
assert.equal(out.processId,p.processId);
p=settled||reg.view(p.processId,owner);
assert.ok(['finished','error'].includes(p.state));
assert.equal(p.exitCode,0);
assert.ok(p.firstOutputAt>=p.startedAt);

const sleepy=reg.start({...owner,script:'sleep 30',cwd:'/tmp',spawnSpec});
assert.equal(reg.list(owner).filter(x=>x.state==='running').length,1);
reg.stop(sleepy.processId,owner,{force:true});
await wait(50);
const stopped=reg.view(sleepy.processId,owner);
assert.notEqual(stopped.state,'running');
assert.throws(()=>reg.output(sleepy.processId,{...owner,agentId:'agent-process-other-001'},{stream:'stdout'}),/process_owner_mismatch/);
console.log('v10-native-process-start-input-output=PASS');
console.log('v10-native-process-stop-owner=PASS');
