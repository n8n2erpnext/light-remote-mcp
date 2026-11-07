import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {UsageRegistry} from '../../operator-host/usage-registry.mjs';

class MeasuredUsageRegistry extends UsageRegistry {
  _persist(){
    this.persistCalls=(this.persistCalls||0)+1;
    return super._persist();
  }
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-t11-usage-read-'));
const stateFile=path.join(dir,'usage.json');
const base=Date.UTC(2026,10,30,23,59,30);
const dec=Date.UTC(2026,11,1,0,0,0);
const accountId='acct-t11-accounting',deviceId='dev-t11-accounting',connectionId='conn-t11-accounting';
let now=base;
const at=(ms)=>new Date(ms).toISOString();
const opened={type:'device_connection_opened',accountId,deviceId,connectionId,at:at(base),hardExpiresAt:dec+30*60_000};

try{
  let usage=new MeasuredUsageRegistry({stateFile,now:()=>now});
  usage.ingest(opened);
  assert.equal(usage.persistCalls,1,'connection open is durable immediately');
  const openedBytes=fs.readFileSync(stateFile,'utf8');

  now=base+10_000;
  assert.equal(usage.summary(accountId,{months:2}).onlineMsThisMonth,10_000);
  now=base+29_000;
  assert.equal(usage.summary(accountId,{months:2}).onlineMsThisMonth,29_000);
  assert.equal(usage.persistCalls,1,'rapid read snapshots must not write the whole registry');
  assert.equal(fs.readFileSync(stateFile,'utf8'),openedBytes,'read checkpoint is deferred on disk');

  now=dec+10_000;
  let s=usage.summary(accountId,{months:2});
  assert.equal(s.series.find(x=>x.month==='2026-11').onlineMs,30_000,'UTC November slice');
  assert.equal(s.series.find(x=>x.month==='2026-12').onlineMs,10_000,'UTC December slice');
  assert.equal(usage.persistCalls,2,'UTC month rollover must checkpoint');

  now=dec+60_000;
  for(let i=0;i<30;i++)assert.equal(usage.summary(accountId,{months:2}).onlineMsThisMonth,60_000);
  assert.equal(usage.persistCalls,2,'unchanged reads must not write repeatedly');

  now=dec+3*60_000;
  assert.equal(usage.summary(accountId,{months:2}).onlineMsThisMonth,3*60_000);
  assert.equal(usage.persistCalls,2,'dirty accrual may stay in memory for bounded window');
  now=dec+5*60_000+11_000;
  assert.equal(usage.summary(accountId,{months:2}).onlineMsThisMonth,5*60_000+11_000);
  assert.equal(usage.persistCalls,3,'read accrual must reach periodic durability checkpoint');

  now=dec+5*60_000+20_000;
  assert.equal(usage.summary(accountId,{months:2}).onlineMsThisMonth,5*60_000+20_000);
  assert.equal(usage.persistCalls,3);
  // Simulate an unclean process exit: only load the actual last disk checkpoint.
  usage=new MeasuredUsageRegistry({stateFile,now:()=>now});
  s=usage.summary(accountId,{months:2});
  assert.equal(s.onlineMsThisMonth,5*60_000+20_000,'crash replay must reconstruct deferred accrual once');
  assert.equal(usage.persistCalls||0,0,'a near-term restored read should not rewrite the registry');

  now=dec+20*60_000;
  usage.ingest({type:'device_connection_renewed',at:at(now),accountId,deviceId,connectionId,hardExpiresAt:dec+90*60_000});
  assert.equal(usage.persistCalls,1,'renewal must force durable accounting');
  assert.equal(usage.openConnections.get(connectionId).hardExpiresAt,dec+90*60_000);
  now=dec+45*60_000;
  assert.equal(usage.summary(accountId,{months:1}).onlineMsThisMonth,45*60_000,'new expiry must allow usage after old cutoff');
  now=dec+90*60_000+10_000;
  const beforeExpiry=usage.persistCalls;
  s=usage.summary(accountId,{months:2});
  assert.equal(s.onlineMsThisMonth,90*60_000,'hard expiry caps online duration');
  assert.equal(s.series.find(x=>x.month==='2026-11').onlineMs,30_000);
  assert.equal(usage.openConnections.has(connectionId),false,'expired row removed from live registry');
  assert.equal(usage.persistCalls,beforeExpiry+1,'hard expiry persists immediately');

  const final=new MeasuredUsageRegistry({stateFile,now:()=>now});
  assert.equal(final.summary(accountId,{months:2}).onlineMsThisMonth,90*60_000,'closed usage survives restart');
  assert.equal(final.summary('acct-foreign',{months:2}).onlineMsThisMonth,0,'Owner isolation');
  now=dec+100*60_000;
  final.ingest({type:'session_activity',action:'toolCalls',accountId,deviceId,at:at(now)});
  assert.equal(final.summary(accountId,{months:1}).toolCallsThisMonth,1,'tool-call write stays immediately durable');
  assert.equal(new MeasuredUsageRegistry({stateFile,now:()=>now}).summary(accountId,{months:1}).toolCallsThisMonth,1);
  console.log('T11_P01_READ_CHECKPOINT_WRITE_PRESSURE=PASS');
  console.log('T11_P01_UTC_MONTH_RENEWAL_EXPIRY_CRASH_ACCOUNT_SCOPE=PASS');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
