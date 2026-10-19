import assert from 'node:assert/strict';
import os from 'node:os';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const owner={accountId:'g2acct',deviceId:'g2dev',sessionId:'g2session',agentId:'g2agent'};
const reg=new NativeProcessRegistry({maxProcesses:2,bufferBytes:65536,stopGraceMs:120});
const spawnSpec=script=>({file:process.execPath,args:['-e',script]});
const p=reg.start({...owner,script:"process.on('SIGTERM',()=>{});console.log('G2_IGNORE_TERM_READY');setInterval(()=>{},1000);",cwd:os.tmpdir(),spawnSpec});
try{
 let ready=false;
 for(let n=0;n<100;n++){if(reg.output(p.processId,owner).output.text.includes('G2_IGNORE_TERM_READY')){ready=true;break;}await sleep(10);}
 assert.ok(ready,'child must install SIGTERM handler');
 reg.stop(p.processId,owner,{force:false});
 await sleep(520);
 const row=reg.view(p.processId,owner);
 console.log('G2_GRACEFUL_STOP_IGNORED_TERM_STATE='+row.state+' PID='+row.pid);
 assert.notEqual(row.state,'running','graceful stop must finish after bounded SIGKILL fallback');
 assert.ok(row.finishedAt,'finishedAt is required for lifecycle reconciliation');
 console.log('G2_GRACEFUL_STOP_ESCALATES_TO_SIGKILL=PASS');
}finally{
 try{reg.stop(p.processId,owner,{force:true});}catch{}
 const row=reg.rows.get(p.processId);try{row?.child?.kill('SIGKILL');}catch{}
 await sleep(60);
}
