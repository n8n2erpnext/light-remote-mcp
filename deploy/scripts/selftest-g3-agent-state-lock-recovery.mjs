import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
const start=source.indexOf('function sleepSync(ms)');
const end=source.indexOf('function writeState(state)',start);
assert.ok(start>0&&end>start,'agent state writer missing');
let now=Date.now(), deadPid=42424242;
const processProxy={pid:process.pid,platform:process.platform,
  kill(pid,signal){
    if(pid===deadPid)throw Object.assign(new Error('dead pid'),{code:'ESRCH'});
    return process.kill(pid,signal);
  }
};
const context=vm.createContext({fs,path,crypto,process:processProxy,SharedArrayBuffer,Atomics,Date});
vm.runInContext(source.slice(start,end),context);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-g3-json-state-lock-'));
const state=path.join(dir,'device.json'),lock=state+'.lock';
function oldLock(body){
  fs.writeFileSync(lock,body,{mode:0o600});
  const twoMinutesAgo=new Date(Date.now()-120000);
  fs.utimesSync(lock,twoMinutesAgo,twoMinutesAgo);
}
try{
  context.writeJson0600(state,{normal:1});
  assert.equal(JSON.parse(fs.readFileSync(state,'utf8')).normal,1);
  assert.equal(fs.existsSync(lock),false,'normal writer should release lock');

  oldLock(JSON.stringify({version:1,pid:deadPid,acquiredAt:Date.now()-120000}));
  context.writeJson0600(state,{recovered:2});
  assert.equal(JSON.parse(fs.readFileSync(state,'utf8')).recovered,2);
  assert.equal(fs.existsSync(lock),false,'dead-owner lock must be reaped');
  assert.equal(fs.existsSync(lock+'.reclaim'),false,'reclaim guard must be released');
  console.log('G3_DEAD_OWNER_STATE_LOCK_RECOVERY_PASS');

  oldLock(JSON.stringify({version:1,pid:process.pid,acquiredAt:Date.now()-120000}));
  assert.throws(()=>context.writeJson0600(state,{mustNotWrite:3}),
    error=>error?.code==='EEXIST','live-owner lock must remain exclusive');
  assert.equal(fs.existsSync(lock),true,'live lock must never be stolen');
  assert.equal(JSON.parse(fs.readFileSync(state,'utf8')).recovered,2);
  fs.rmSync(lock);
  console.log('G3_LIVE_OWNER_LOCK_FAIL_CLOSED_PASS');

  oldLock('');
  assert.throws(()=>context.writeJson0600(state,{mustNotWrite:4}),
    error=>error?.code==='EEXIST','legacy empty lock ownership is unprovable');
  assert.equal(fs.existsSync(lock),true,'unknown lock must remain for manual investigation');
  fs.rmSync(lock);
  console.log('G3_LEGACY_LOCK_FAIL_CLOSED_PASS');

  oldLock(JSON.stringify({version:1,pid:deadPid,acquiredAt:Date.now()-120000}));
  fs.writeFileSync(lock+'.reclaim','other reclaimer');
  assert.throws(()=>context.writeJson0600(state,{mustNotWrite:5}),
    error=>error?.code==='EEXIST','live recovery guard must block other reclaimers');
  assert.equal(fs.existsSync(lock),true);
  console.log('G3_CONCURRENT_RECLAIM_GUARD_FAIL_CLOSED_PASS');

  const anchor=source.indexOf("const response=await channelRequest(state,hub,'poll',payload)");
  const store=source.indexOf('try{writeState(state);}',anchor);
  const rejected=source.indexOf("'agent_state_persistence_unavailable'",store);
  const dispatch=source.indexOf('COMMAND_EXECUTIONS.run(command.commandId',store);
  assert.ok(anchor>0&&store>anchor&&rejected>store&&dispatch>rejected,
    'write failure must report negative result before command execution');
  console.log('G3_STATE_PERSISTENCE_NEGATIVE_RESULT_FAIL_CLOSED_PASS');
}finally{
  fs.rmSync(dir,{recursive:true,force:true});
}
