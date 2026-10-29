import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';

const commandId='cmd_11111111-2222-4333-8444-555555555555';
const row={id:'11111111-1111-4111-8111-111111111111',
 accountId:'acct1',deviceId:'dev1',nodeId:'node1',
 sessionId:'session1',agentId:'agent1',startedAt:Date.now(),
 status:'cancelled',commandId,signedResultVerified:true,finishedAt:Date.now(),exitCode:130,
 remote:true,requiredCapabilities:[]};
const records=new Map();
const pool={async query(sql,args=[]){
 if(sql.startsWith('INSERT INTO lr_gold_job_records')){
  const view=JSON.parse(args[10]);records.set(args[0],view);
  return {rowCount:1,rows:[]};
 }
 if(sql.startsWith('SELECT public_view FROM lr_gold_job_records') && sql.includes("public_view->>'commandId'")){
  const matched=[...records.values()].filter(v=>v.commandId===args[0]&&v.accountId===args[1]&&v.deviceId===args[2]&&v.nodeId===args[3]);
  return {rows:matched.map(public_view=>({public_view})).slice(0,2)};
 }
 throw Error('unexpected_sql:'+sql.slice(0,70));
}};
const ledger=new GoldJobLedger({pool,redact:v=>v});
ledger.save(row);await ledger.flush();
assert.equal(records.get(row.id).commandId,commandId);
let completed=await ledger.completedForCommand({commandId,accountId:'acct1',deviceId:'dev1',nodeId:'node1'});
assert.equal(completed.status,'cancelled');
assert.equal(completed.exitCode,130);
assert.equal(await ledger.completedForCommand({commandId,accountId:'other',deviceId:'dev1',nodeId:'node1'}),null);
assert.equal(await ledger.completedForCommand({commandId,accountId:'acct1',deviceId:'dev1',nodeId:'other'}),null);
assert.equal(await ledger.completedForCommand({commandId:'cmd_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',accountId:'acct1',deviceId:'dev1',nodeId:'node1'}),null);
await assert.rejects(()=>ledger.completedForCommand({commandId:'invalid',accountId:'acct1',deviceId:'dev1',nodeId:'node1'}),/owner_scope_required/);
records.get(row.id).status='interrupted';
assert.equal(await ledger.completedForCommand({commandId,accountId:'acct1',deviceId:'dev1',nodeId:'node1'}),null);
records.get(row.id).status='cancelled';
records.get(row.id).signedResultVerified=false;
assert.equal(await ledger.completedForCommand({commandId,accountId:'acct1',deviceId:'dev1',nodeId:'node1'}),null,'operator timeout cannot impersonate signed terminal');
records.get(row.id).signedResultVerified=true;
records.set('other-record',{...records.get(row.id),jobId:'other-record'});
await assert.rejects(()=>ledger.completedForCommand({commandId,accountId:'acct1',deviceId:'dev1',nodeId:'node1'}),/receipt_ambiguous/);
records.delete('other-record');

// Exercise the actual signed-result handler without a Fleet or JSONL receipt.
const source=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
const start=source.indexOf('  const acceptDeviceResult=async(');
const end=source.indexOf("    if (req.method === 'POST' && url.pathname === '/v1/enrollments/begin')",start);
assert.ok(start>=0&&end>start);
const scope={
 jobs:new Map(),
 fleet:{command(){throw Error('command_not_found')},receipt(){return null}},
 abandonedCommandReceiptFromDisk:()=>null,
 completedCommandReceiptFromDisk:()=>null,
 goldJobs:ledger,
 FleetError:class extends Error{constructor(code,status){super(code);this.status=status}},
 Buffer,MAX_MEMORY_OUTPUT:100000
};
const fn=vm.runInNewContext(source.slice(start,end)+';acceptDeviceResult',scope);
const ctx={binding:{accountId:'acct1'},device:{deviceId:'dev1',nodeId:'node1'}};
const replay=await fn(ctx,{commandId,status:'cancelled',exitCode:130});
assert.equal(replay.accepted,true);
assert.equal(replay.duplicate,true);
assert.equal(replay.job.commandId,commandId);
let prevented=false;
try{await fn({binding:{accountId:'other'},device:ctx.device},{commandId,status:'cancelled',exitCode:130})}catch(e){prevented=e.message==='command_not_found'}
assert.equal(prevented,true,'cross-account replay cannot ACK');
records.get(row.id).finishedAt=null;
await assert.rejects(()=>fn(ctx,{commandId}),/command_not_found/);
console.log('P0_GOLD_PG_COMMITTED_COMMAND_REPLAY_WITHOUT_JSONL_RECEIPT_OWNER_SCOPED_PASS');
