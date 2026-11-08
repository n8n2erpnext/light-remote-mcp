import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const owner={accountId:'g2acct',deviceId:'g2dev',sessionId:'g2session',agentId:'g2agent'};
if(process.platform!=='linux'){console.log('G2_PROCESS_TREE=SKIP_NON_LINUX');process.exit(0);}
const reg=new NativeProcessRegistry({stopGraceMs:150});
const p=reg.start({...owner,cwd:'/tmp',script:"sleep 30 & child=$!; echo G2_CHILD_PID=$child; wait $child",spawnSpec:script=>({file:'/bin/bash',args:['-lc',script]})});
let childPid=0;
const alive=pid=>{try{const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8').split(' ');return stat[2]!=='Z'&&stat[2]!=='X';}catch{return false;}};
try{
 for(let i=0;i<120;i++){const text=reg.output(p.processId,owner).output.text;const m=text.match(/G2_CHILD_PID=(\d+)/);if(m){childPid=Number(m[1]);break;}await sleep(10);}
 assert.ok(childPid>0&&alive(childPid),'helper child must exist');
 reg.stop(p.processId,owner,{force:false});
 await sleep(400);
 const parent=reg.view(p.processId,owner);
 console.log('G2_TREE_PARENT='+parent.state+' CHILD_ALIVE='+alive(childPid));
 assert.equal(alive(childPid),false,'stopping managed process must not orphan spawned child');
 console.log('G2_PROCESS_CHILD_TREE_STOP=PASS');
}finally{if(childPid&&alive(childPid))try{process.kill(childPid,'SIGKILL');}catch{};try{reg.stop(p.processId,owner,{force:true});}catch{};await sleep(60);}
