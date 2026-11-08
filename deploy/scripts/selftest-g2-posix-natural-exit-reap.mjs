import assert from 'node:assert/strict';
import fs from 'node:fs';
import {NativeProcessRegistry} from '../../lib/native-process.mjs';
if(process.platform!=='linux'&&process.platform!=='darwin'){
 console.log('G2_POSIX_NATURAL_PARENT_EXIT_REAP=SKIP_NON_POSIX');
 process.exit(0);
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const owner={accountId:'g2-natural',deviceId:'g2-test-device',sessionId:'g2-session',agentId:'g2-test-agent'};
const registry=new NativeProcessRegistry();
let childPid=0,groupId=0;
const alive=pid=>{
 try{
   process.kill(pid,0);
   if(process.platform==='linux'){
     const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');
     const m=stat.match(/^\d+ \(.+\) ([A-Z])/);
     return m&&!['Z','X'].includes(m[1]);
   }
   return true;
 }catch(error){if(error?.code==='ESRCH'||error?.code==='ENOENT')return false;throw error;}
};
try{
 const processRow=registry.start({...owner,cwd:'/tmp',script:'sleep 45 & child=$!; echo G2_NATURAL_CHILD_PID=$child; exit 0',spawnSpec:script=>({file:'/bin/bash',args:['-lc',script]})});
 groupId=processRow.processGroupId;
 const until=Date.now()+6000;
 let finished=null;
 while(Date.now()<until){
   const result=registry.output(processRow.processId,owner,{stream:'stdout',limit:1024});
   const match=result.output.text.match(/G2_NATURAL_CHILD_PID=(\d+)/);
   if(match)childPid=Number(match[1]);
   finished=registry.view(processRow.processId,owner);
   if(finished.finishedAt&&childPid)break;
   await sleep(20);
 }
 assert.ok(childPid>0,'Linux managed bash must report child PID');
 assert.equal(finished?.state,'finished');
 assert.equal(finished?.exitCode,0,'Parent natural exit remains successful');
 assert.equal(finished?.groupCleanup,'sent','Dedicated group signal must be issued on natural exit');
 for(let i=0;i<60&&alive(childPid);i++)await sleep(20);
 assert.equal(alive(childPid),false,'Background child may not survive managed parent natural exit');
 console.log('G2_POSIX_NATURAL_PARENT_EXIT_NO_ORPHAN=PASS');
 console.log('G2_POSIX_GROUP_REAP_EVIDENCE=PASS');
}finally{
 registry.close();
 if(groupId)try{process.kill(-groupId,'SIGKILL')}catch(error){if(error.code!=='ESRCH')throw error;}
}
