import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
import {deviceResourceIntent} from '../../operator-host/device-resource-intent.mjs';

// Real PostgreSQL concurrency fixture, only in isolated Gold UAT.
// Uses synthetic device/account IDs; no network download or real filesystem.
const db=await connectGoldStorage();
const scheduler=new GoldPersonalAgentScheduler({
 pool:db.pool,resources:new GoldDeviceResourceLocks({capacity:2})
});
const nonce=crypto.randomBytes(8).toString('hex');
const accounts=Array.from({length:4},(_,i)=>'m4_download_fixture_'+nonce+'_'+i);
const deviceId='m4_download_device_'+nonce;
function entry(index,script,cwd){
 const resource=deviceResourceIntent({family:'process',op:'start',request:{cwd,script}});
 return {jobId:crypto.randomUUID(),operationId:'fixture_op_'+nonce+'_'+index,
  accountId:accounts[index],agentId:'fixture_agent_'+nonce+'_'+index,
  sessionId:'fixture_session_'+nonce+'_'+index,deviceId,resource};
}
const download=entry(0,'wget https://example.invalid/archive.tar','/opt/workspace-a');
const build=entry(1,'make all','/opt/workspace-a');
const parallel=entry(2,'make all','/opt/workspace-b');
const explicit=entry(3,'curl -fL -o /opt/workspace-a/archive.tar https://example.invalid/archive.tar','/opt/workspace-b');
try{
 assert.equal(download.resource.resourceKey,'project:/opt/workspace-a');
 assert.equal(download.resource.mode,'exclusive');
 assert.equal(explicit.resource.resourceKey,'file-dir:/opt/workspace-a');
 for(const item of [download,build,parallel,explicit])await scheduler.enqueue(item);
 assert.deepEqual(await scheduler.admit(download.accountId,3),[download.jobId]);
 // M3 permits only one live foreground OS effect per device. The old
 // fixture incorrectly expected unrelated work to start before the initial
 // command handed off its background worker lease.
 assert.deepEqual(await scheduler.admit(parallel.accountId,3),[]);
 const initial=await db.pool.query('SELECT queue_reason FROM lr_gold_personal_agent_work WHERE job_id=$1',[parallel.jobId]);
 assert.equal(initial.rows[0]?.queue_reason,'QUEUED_AGENT_SLOT');
 console.log('M3_DOWNLOAD_FOREGROUND_DEVICE_SLOT_SERIALIZED=PASS');
 const processId='lp_'+crypto.randomBytes(18).toString('base64url');
 await scheduler.complete(download.jobId,download.accountId,'ok',{processId});
 // A confirmed background launch releases the device's foreground slot but
 // retains its exclusive project resource claim until trusted terminal evidence.
 assert.deepEqual(await scheduler.admit(build.accountId,3),[]);
 assert.deepEqual(await scheduler.admit(explicit.accountId,3),[]);
 assert.deepEqual(await scheduler.admit(parallel.accountId,3),[parallel.jobId]);
 const r=await db.pool.query("SELECT account_id,queue_reason FROM lr_gold_personal_agent_work WHERE account_id=ANY($1::text[]) AND state='queued'",[accounts]);
 const reasons=new Map(r.rows.map(row=>[row.account_id,row.queue_reason]));
 assert.equal(reasons.get(build.accountId),'RESOURCE_LOCKED');
 assert.equal(reasons.get(explicit.accountId),'RESOURCE_LOCKED');
 console.log('M4_WGET_BUILD_SAME_PROJECT_RESOURCE_LOCKED=PASS');
 console.log('M4_CURL_ABSOLUTE_OUTPUT_CONFLICTS_WITH_WORKSPACE=PASS');
 console.log('M4_BACKGROUND_DOWNLOAD_AND_UNRELATED_BUILD_PARALLEL=PASS');
 await scheduler.complete(parallel.jobId,parallel.accountId,'ok');
 // Simulated verified terminal is strictly fixture-owned: no real device
 // claim or terminal receipt is created, and no admin orphan path is used.
 const released=await scheduler.resources.releaseVerifiedTerminal(db.pool,{
  accountId:download.accountId,deviceId,
  process:{processId,state:'finished',finishedAt:Date.now()}
 });
 assert.equal(released,true);
 assert.deepEqual(await scheduler.admit(build.accountId,3),[build.jobId]);
 assert.deepEqual(await scheduler.admit(explicit.accountId,3),[]);
 await scheduler.complete(build.jobId,build.accountId,'ok');
 assert.deepEqual(await scheduler.admit(explicit.accountId,3),[explicit.jobId]);
 await scheduler.complete(explicit.jobId,explicit.accountId,'ok');
 const leftover=await db.pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims WHERE device_id=$1',[deviceId]);
 assert.equal(leftover.rows[0].n,0);
 console.log('M4_DOWNLOAD_RESOURCE_LOCK_RELEASE_QUEUE_PROMOTION=PASS');
}finally{
 for(const accountId of accounts)
  await db.pool.query('DELETE FROM lr_gold_personal_agent_work WHERE account_id=$1',[accountId]);
 await db.close();
}
