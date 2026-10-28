import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
const a=src.indexOf('  const acceptDeviceResult=async(');
const b=src.indexOf("    if (req.method === 'POST' && url.pathname === '/v1/enrollments/begin')",a);
assert.ok(a>0&&b>a);
const code=src.slice(a,b);
const ctx={binding:{accountId:'acct'},device:{deviceId:'dev',nodeId:'node'}};
const receipt={commandId:'cmd1',jobId:'11111111-1111-4111-8111-111111111111',accountId:'acct',deviceId:'dev',nodeId:'node'};
const terminal={jobId:receipt.jobId,accountId:'acct',deviceId:'dev',status:'cancelled',finishedAt:Date.now(),exitCode:130,effectState:'result_observed'};
async function check(r,db,disk=null){
 let calls=0;class FleetError extends Error{constructor(code,status){super(code);this.status=status;}}
 const context={FleetError,jobs:new Map(),Buffer,MAX_MEMORY_OUTPUT:10000,
   fleet:{command(){throw Error('command_not_found');},receipt(){return r;}},
   abandonedCommandReceiptFromDisk:()=>disk,
   goldJobs:{async get(){calls++;return db;}},
   jobView(){throw Error('live_job_view_used_on_database_snapshot');}
 };
 const fn=vm.runInNewContext(code+';acceptDeviceResult',context);
 try{return {value:await fn(ctx,{commandId:'cmd1'}),calls};}
 catch(e){return {error:e.message,calls};}
}
let r=await check(receipt,terminal);
assert.equal(r.value.accepted,true);
assert.equal(r.value.duplicate,true);
assert.equal(r.value.job.status,'cancelled');
assert.equal(r.calls,1);
r=await check({...receipt,abandoned:true},terminal);
assert.equal(r.error,'command_abandoned_effect_unknown');assert.equal(r.calls,0);
for(const db of [null,{...terminal,finishedAt:null},{...terminal,status:'interrupted'},{...terminal,accountId:'other'},{...terminal,deviceId:'other'},{...terminal,exitCode:null}]){
 r=await check(receipt,db);assert.equal(r.error,'command_terminal_commit_unverified');
}
r=await check({...receipt,accountId:'other'},terminal);
assert.equal(r.error,'command_device_mismatch');assert.equal(r.calls,0);
r=await check(null,terminal,{...receipt,abandoned:true,recoveredFromDisk:true});
assert.equal(r.error,'command_abandoned_effect_unknown');assert.equal(r.calls,0);
console.log('P0_GOLD_REPLAY_TERMINAL_PG_ONLY_AND_ABANDONED_DENY_PASS');
