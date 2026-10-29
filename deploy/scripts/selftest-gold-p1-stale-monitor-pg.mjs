// Gold P1-A monitor: opt-in read-only interval scan, tenant isolation,
// deduplicated notifications and fail-closed if PostgreSQL cannot return data.
import assert from 'node:assert/strict';
import pg from 'pg';
import {GoldStaleClaimMonitor} from '../../lib/gold-stale-claim-monitor.mjs';
const db=process.env.LR_GOLD_EPOCH_TEST_DB;
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1');
assert.match(db||'',/^lr_gold_epoch_fixture_[0-9]{8}$/);
const pool=new pg.Pool({database:db,max:2});
const account='acct-p1-stale-owner',other='acct-foreign',device='dev-p1-stale-primary',
 foreign='dev-p1-stale-other',alerts=[];
const fresh=(await pool.query('SELECT claimed_at FROM lr_gold_device_resource_claims WHERE job_id=$1',['p1-fresh'])).rows[0];
assert.ok(fresh?.claimed_at);
const now=fresh.claimed_at.getTime()+3600000-1000;
let views=[{accountId:account,deviceId:device,state:'online'},
 {accountId:other,deviceId:device,state:'online'},
 {accountId:account,deviceId:foreign,state:'online'}];
try{
 assert.throws(()=>new GoldStaleClaimMonitor({pool,getDeviceViews:()=>views}),/allowlist_required/);
 const monitor=new GoldStaleClaimMonitor({
   pool,getDeviceViews:()=>views,allowedDevices:[device],
   minimumAgeMs:3600000,now:()=>now,onAlert:alert=>alerts.push(alert)
 });
 const before=Number((await pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims')).rows[0].n);
 const first=await monitor.tick();
 assert.equal(first.ok,true);assert.equal(first.claimCount,4,'both owner partitions must be checked');
 const owner=monitor.snapshotForOwner(account,[device]),otherOwner=monitor.snapshotForOwner(other,[device]);
 assert.equal(owner.staleClaims.length,3);assert.equal(otherOwner.staleClaims.length,1);
 assert.equal(owner.staleClaims.some(x=>x.jobId==='p1-foreign-account'),false);
 assert.equal(owner.staleClaims.some(x=>x.jobId==='p1-foreign-device'),false);
 assert.equal(owner.staleClaims.every(x=>x.releaseAllowed===false),true);
 assert.equal(owner.staleClaims.every(x=>!Object.hasOwn(x,'accountId')),true);
 assert.deepEqual(monitor.snapshotForOwner(account,[foreign]).staleClaims,[]);
 assert.equal(alerts.length,2);
 const repeat=await monitor.tick();assert.equal(repeat.ok,true);
 assert.equal(alerts.length,2,'unchanged stale alerts must not be repeatedly broadcast');
 assert.throws(()=>monitor.snapshotForOwner(account,['invalid device']),/owner_scope_invalid/);
 const after=Number((await pool.query('SELECT count(*)::int n FROM lr_gold_device_resource_claims')).rows[0].n);
 assert.equal(after,before,'monitor cannot retire M4 claims');
 const noTerminal=Number((await pool.query('SELECT count(*)::int n FROM lr_gold_terminal_receipt_acks WHERE job_id=$1',['p1-no-pid'])).rows[0].n);
 assert.equal(noTerminal,0,'monitor cannot invent a terminal ACK');
 // Fail-closed: a query error invalidates the in-memory previous success.
 const fail=new GoldStaleClaimMonitor({pool:{query:async()=>{throw Error('PG_UNAVAILABLE');}},
   getDeviceViews:()=>views,allowedDevices:[device],now:()=>now});
 await assert.rejects(()=>fail.tick(),/PG_UNAVAILABLE/);
 assert.match(fail.snapshotForOwner(account,[device]).error,/PG_UNAVAILABLE/);
 assert.equal(fail.snapshotForOwner(account,[device]).staleClaims.length,0);
 console.log(JSON.stringify({ok:true,realPostgres:true,ownerScoped:true,
   ownerClaims:owner.staleClaims.length,otherOwnerClaims:otherOwner.staleClaims.length,
   deduplicatedAlerts:true,failClosedOnDbError:true,readOnly:true,
   noCrossTenantLeak:true,noClaimsReleased:true,noSignedTerminalFabricated:true}));
}finally{await pool.end();}
