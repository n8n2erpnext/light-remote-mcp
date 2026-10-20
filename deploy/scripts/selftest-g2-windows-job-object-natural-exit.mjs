import assert from 'node:assert/strict';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';

if(process.platform!=='win32'){console.log('G2_WINDOWS_JOB_OBJECT=SKIP_NON_WINDOWS');process.exit(0);}
const helper=String(process.env.LIGHT_REMOTE_MANAGED_PROCESS_HELPER||'');
assert.ok(helper&&fs.existsSync(helper),'Gold Windows Job Object helper must be the staged native tray executable');
const reg=new NativeProcessRegistry({stopGraceMs:120});
const owner={accountId:'g2-job',deviceId:'g2-device',sessionId:'g2-session',agentId:'g2-agent'};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const childCode="setInterval(()=>{},1000)";
const parentCode="const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e',"+JSON.stringify(childCode)+"],{windowsHide:true,stdio:'ignore'});console.log('G2_NATURAL_CHILD_PID='+c.pid);";
const getAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}};
const row=reg.start({...owner,cwd:os.tmpdir(),script:parentCode,spawnSpec:()=>({file:process.execPath,args:['-e',parentCode]})});
let childPid=0;
try{
 assert.equal(row.treeContainment,'job-object-kill-on-close');
 const startDeadline=Date.now()+9000;
 while(Date.now()<startDeadline&&!childPid){
   const view=reg.output(row.processId,owner,{stream:'stdout',limit:1000});
   const match=view.output.text.match(/G2_NATURAL_CHILD_PID=(\d+)/);
   if(match)childPid=Number(match[1]);
   await pause(35);
 }
 assert.ok(childPid>0,'Node parent must print real child PID through envelope stdout');
 const deadline=Date.now()+9000;
 let finished=null;
 while(Date.now()<deadline){
   finished=reg.view(row.processId,owner);
   if(finished.finishedAt&&!getAlive(childPid))break;
   await pause(35);
 }
 assert.equal(finished?.state,'finished','Natural shell exit must be observable');
 assert.equal(finished?.exitCode,0,'Helper forwards real parent exit code');
 assert.equal(getAlive(childPid),false,'Job Object must terminate child on natural parent exit');
 console.log('G2_WINDOWS_JOB_OBJECT_NATURAL_PARENT_EXIT_NO_ORPHAN=PASS');
 console.log('G2_WINDOWS_JOB_OBJECT_STDOUT_AND_EXIT_CODE=PASS');
 const stdinCode="process.stdin.on('data',chunk=>process.stdout.write('G2_PIPE_'+chunk.toString().trim()));process.stdin.on('end',()=>process.exit(0))";
 const piped=reg.start({...owner,cwd:os.tmpdir(),script:stdinCode,spawnSpec:()=>({file:process.execPath,args:['-e',stdinCode]})});
 reg.input(piped.processId,owner,{data:'STDIN_OK\n',eof:true});
 const ioDeadline=Date.now()+8000;let io=null,ioText='';
 while(Date.now()<ioDeadline){
   io=reg.view(piped.processId,owner);
   ioText=reg.output(piped.processId,owner,{stream:'stdout',limit:600}).output.text;
   if(io.finishedAt&&ioText.includes('G2_PIPE_STDIN_OK'))break;
   await pause(40);
 }
 assert.equal(io?.exitCode,0,'Job Object helper must forward stdin EOF/exit code');
 assert.match(ioText,/G2_PIPE_STDIN_OK/,'Job Object helper must inherit agent stdin/stdout pipes');
 console.log('G2_WINDOWS_JOB_OBJECT_STDIN_STDOUT_PASSTHROUGH=PASS');
 // AgentHost already holds the outer Agent in a kill-on-close job. Prove the
 // per-process envelope works inside a nested Windows Job Object as well.
 if(process.env.G2_NESTED_JOB_FIXTURE!=='1'){
   const nested=spawnSync(helper,['--managed-process',process.execPath,process.argv[1]],{cwd:os.tmpdir(),env:{...process.env,G2_NESTED_JOB_FIXTURE:'1'},encoding:'utf8',timeout:16000,windowsHide:true});
   assert.equal(nested.status,0,'nested Job Object regression: '+String(nested.stderr||nested.error?.message||''));
   assert.match(nested.stdout||'',/G2_WINDOWS_JOB_OBJECT_NATURAL_PARENT_EXIT_NO_ORPHAN=PASS/);
   console.log('G2_WINDOWS_JOB_OBJECT_NESTED_AGENT_HOST_COMPAT=PASS');
 }
}finally{
 reg.close();
 if(childPid&&getAlive(childPid))try{process.kill(childPid,'SIGKILL')}catch{}
}
