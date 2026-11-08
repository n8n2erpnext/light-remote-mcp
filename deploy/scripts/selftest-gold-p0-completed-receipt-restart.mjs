import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const start=src.indexOf('function completedCommandReceiptFromDisk(');
const end=src.indexOf('function fullOutputFromDisk(',start);
assert.ok(start>0&&end>start,'completed receipt recovery function exists');
const fn=src.slice(start,end);
const id='cmd_11111111-2222-4333-8444-555555555555';
const event={type:'node_command_completed',commandId:id,jobId:'job-alpha',
 accountId:'account-alpha',deviceId:'device-alpha',nodeId:'node-alpha',
 at:new Date().toISOString(),status:'completed'};
function restore(lines,now=Date.now()){
 return vm.runInNewContext(fn+';completedCommandReceiptFromDisk',{
  logFilesOldestFirst:()=>['log.jsonl'],
  readLogText:()=>lines.join('\n'),Date
 })(id,{now});
}
const valid=restore([JSON.stringify(event)]);
assert.equal(valid?.jobId,'job-alpha');
assert.equal(valid?.recoveredFromDisk,true);
assert.equal(valid?.duplicate,true);
assert.equal(valid?.abandoned,undefined,'completed cannot be represented as abandoned');
assert.equal(restore([JSON.stringify({...event,type:'node_command_abandoned'})]),null);
assert.equal(restore([JSON.stringify({...event,accountId:null})]),null);
assert.equal(restore([JSON.stringify({...event,commandId:'cmd_99999999-2222-4333-8444-555555555555'})]),null);
assert.equal(restore([JSON.stringify({...event,at:new Date(Date.now()-3*86400000).toISOString()})]),null);
assert.equal(restore(['not json']),null);
assert.equal(restore([]),null);
console.log('P0_GOLD_COMPLETED_FLEET_RECEIPT_RESTART_DISK_RECOVERY_FAIL_CLOSED_PASS');
