import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopV4OwnerActivityPage} from './desktop-v4-owner-activity-page.mjs';
const OWNER='owner',FOREIGN='other',SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
function fixture(n=260,opts={}){
 const state={valid:true,month:'2026-11',revision:3,afterRead:()=>{},now:1794000000000};
 const devices=Array.from({length:n},(_,i)=>({accountId:OWNER,
   deviceId:'d-'+String(i).padStart(5,'0'),state:'online'}));
 devices.push({accountId:FOREIGN,deviceId:'foreign-dev',state:'online'});
 const usageRows=devices.filter(d=>d.accountId===OWNER)
  .map((d,i)=>({deviceId:d.deviceId,toolCalls:i,onlineMs:i*30,secret:'NEVER'}));
 usageRows.push({deviceId:'foreign-dev',toolCalls:999,onlineMs:999});
 const jobs=new Map(Array.from({length:n-20},(_,i)=>[
  'job-'+String(i).padStart(5,'0'),{accountId:OWNER,
   id:'job-'+String(i).padStart(5,'0'),deviceId:devices[i%n].deviceId,agentId:'a'+i,
   sessionId:'s-'+i,status:'running',startedAt:100+i,stdout:'SECRET_LOG'}
 ]));
 jobs.set('foreign',{accountId:FOREIGN,id:'foreign-job',
   deviceId:'foreign-dev',status:'running',stdout:'FOREIGN'});
 const sessionsRows=Array.from({length:n-10},(_,i)=>({
  accountId:OWNER,sessionId:'s-'+String(i).padStart(5,'0'),
  deviceId:devices[i%n].deviceId,agentId:'agent-'+i,state:'active',
  createdAt:100+i,activeJobs:[],workspace:'/private/workspace'
 }));
 sessionsRows.push({accountId:FOREIGN,sessionId:'foreign-session',deviceId:'foreign-dev'});
 const accounts={
  get ownerRevision(){return state.revision;},
  desktopOwnerSessionActive:(a,s)=>state.valid&&a===OWNER&&s===SESSION,
  account:a=>({accountId:a,isOwner:a===OWNER,emailVerified:true,status:'active'})
 };
 const api=createDesktopV4OwnerActivityPage({
  accounts,allDeviceViews:({accountId}={})=>devices.filter(d=>!accountId||d.accountId===accountId),
  usage:{summary:(a,{months})=>{assert.equal(a,OWNER);assert.equal(months,1);
    state.afterRead();return {currentMonth:state.month,devices:usageRows};}},
  sessions:{list:()=>sessionsRows},jobs,now:()=>state.now,
  goldJobs:opts.goldJobs,sessionBacking:opts.sessionBacking
 });
 const read=(kind,cursor=null,limit=100,accountId=OWNER,accountSessionId=SESSION)=>
   api({accountId,accountSessionId,page:{kind,cursor,limit}});
 return {state,devices,usageRows,jobs,sessionsRows,read};
}
test('F15 monthly usage pages 100/100/60 with honest current month and no foreign data',async()=>{
 const f=fixture();
 const a=await f.read('usage');
 assert.deepEqual([a.rows.length,a.coverage.total,a.month],[100,260,'2026-11']);
 const b=await f.read('usage',a.coverage.nextCursor);
 const c=await f.read('usage',b.coverage.nextCursor);
 assert.deepEqual([b.rows.length,c.rows.length,c.coverage.hasMore],[100,60,false]);
 assert.equal(c.coverage.nextCursor,null);
 assert.equal(a.coverage.source,'owner_current_month_usage');
 const all=[...a.rows,...b.rows,...c.rows];
 assert.equal(new Set(all.map(r=>r.deviceId)).size,260);
 assert.ok(!JSON.stringify(all).includes('NEVER'));
 assert.ok(!JSON.stringify(all).includes('foreign'));
});
test('F15 jobs + sessions page full current in-memory registry, never promises durable history',async()=>{
 const f=fixture();
 for(const [kind,expected] of [['jobs',240],['sessions',250]]){
  let cursor=null,received=[],coverage;
  do{
   const page=await f.read(kind,cursor);
   received.push(...page.rows);
   cursor=page.coverage.nextCursor;
   coverage=page.coverage;
   assert.equal(coverage.source,'in_memory_current_window');
  }while(cursor);
  assert.equal(received.length,expected);
  assert.equal(coverage.total,expected);
  assert.ok(!JSON.stringify(received).includes('stdout'));
  assert.ok(!JSON.stringify(received).includes('workspace'));
  assert.ok(!JSON.stringify(received).includes('foreign'));
 }
});
test('F15 changed membership, month rollover and session history pruning reject stale cursors',async()=>{
 const f=fixture();
 const u=await f.read('usage');
 f.state.month='2026-12';
 await assert.rejects(f.read('usage',u.coverage.nextCursor),/cursor_stale/);
 const j=await f.read('jobs');
 f.jobs.delete('job-00001');
 await assert.rejects(f.read('jobs',j.coverage.nextCursor),/cursor_stale/);
 const s=await f.read('sessions');
 f.sessionsRows.shift();
 await assert.rejects(f.read('sessions',s.coverage.nextCursor),/cursor_stale/);
});
test('F15 foreign Owner, cross-kind, invalid cursor and limit fail closed',async()=>{
 const f=fixture();
 const a=await f.read('jobs');
 await assert.rejects(f.read('jobs',a.coverage.nextCursor,100,FOREIGN),/owner_required/);
 await assert.rejects(f.read('sessions',a.coverage.nextCursor),/cursor_scope_mismatch/);
 await assert.rejects(f.read('jobs',a.coverage.nextCursor,10),/cursor_scope_mismatch/);
 await assert.rejects(f.read('jobs','BAD!'),/cursor_invalid/);
 await assert.rejects(f.read('bogus'),/kind_invalid/);
 for(const v of [0,101,1.5,-1,'10'])await assert.rejects(f.read('usage',null,v),/limit_invalid/);
});
test('F15 Owner revoked while usage.summary is read fails before returning results',async()=>{
 const f=fixture();
 let once=false;
 f.state.afterRead=()=>{if(!once){once=true;queueMicrotask(()=>{f.state.valid=false;});}};
 await assert.rejects(f.read('usage'),/owner_required/);
});
test('F15 updated live usage counters do not cause impossible/stale page cursors',async()=>{
 const f=fixture();
 const a=await f.read('usage');
 f.usageRows[0].onlineMs+=300;
 const b=await f.read('usage',a.coverage.nextCursor);
 assert.equal(b.rows.length,100);
});
test('F15 10000 simulated Owner usage records only project 100 per page',async()=>{
 const f=fixture(10000);
 const r=await f.read('usage');
 assert.equal(r.coverage.total,10000);
 assert.equal(r.rows.length,100);
 assert.equal(r.coverage.hasMore,true);
});

function pgHistoryFixture(){
 const history=Array.from({length:260},(_,i)=>({
  jobId:'j-'+String(i).padStart(5,'0'),deviceId:'d-'+String(i).padStart(5,'0'),
  agentId:'agent-'+i,sessionId:'session-'+i,status:'ok',
  startedAt:1794000000000-i*1000,finishedAt:1794000000001-i*1000,
  exitCode:0,stdout:'TOP_SECRET',workspace:'PRIVATE'
 }));
 const calls=[];
 let intercept=()=>{};
 const goldJobs={async pageForOwner({accountId,deviceIds,limit,anchorMs,after}){
  calls.push({accountId,deviceIds:[...deviceIds],limit,anchorMs,after});
  intercept();
  const ids=new Set(deviceIds);
  const filtered=history.filter(j=>ids.has(j.deviceId)&&j.startedAt<=anchorMs);
  const window=after?filtered.filter(j=>j.startedAt<after.startedAtMs||
    j.startedAt===after.startedAtMs&&j.jobId<after.jobId):filtered;
  return {total:filtered.length,rows:window.slice(0,limit),
    hasMore:window.length>limit};
 }};
 const f=fixture(260,{goldJobs});
 return {...f,history,calls,onPgRead:callback=>{intercept=callback}};
}
test('F15 H2 PostgreSQL persisted Owner jobs page 100/100/60 across >250 devices',async()=>{
 const f=pgHistoryFixture();
 const a=await f.read('jobs');
 const b=await f.read('jobs',a.coverage.nextCursor);
 const c=await f.read('jobs',b.coverage.nextCursor);
 assert.deepEqual([a.rows.length,b.rows.length,c.rows.length],[100,100,60]);
 assert.equal(a.coverage.total,260);
 assert.equal(a.coverage.source,'postgresql_owner_job_history');
 assert.equal(c.coverage.nextCursor,null);
 assert.equal(new Set([...a.rows,...b.rows,...c.rows].map(j=>j.jobId)).size,260);
 assert.equal(f.calls[0].deviceIds.length,260);
 assert.deepEqual(f.calls.map(c=>c.limit),[100,100,100]);
 assert.ok(!JSON.stringify([a,b,c]).includes('TOP_SECRET'));
 assert.ok(!JSON.stringify([a,b,c]).includes('PRIVATE'));
});
test('F15 H2 stale membership, revoked Owner and expired PG keyset fail closed',async()=>{
 const f=pgHistoryFixture();
 const first=await f.read('jobs');
 f.devices[0].state='revoked';
 await assert.rejects(f.read('jobs',first.coverage.nextCursor),/cursor_stale/);
 const g=pgHistoryFixture();
 const initial=await g.read('jobs');
 g.state.now+=3600001;
 await assert.rejects(g.read('jobs',initial.coverage.nextCursor),/cursor_expired/);
 const h=pgHistoryFixture();
 h.onPgRead(()=>{h.state.valid=false;});
 await assert.rejects(h.read('jobs'),/owner_required/);
});
test('F15 H2 asynchronous PostgreSQL return after device relink fails closed',async()=>{
 const f=pgHistoryFixture();
 f.onPgRead(()=>{f.devices[0].accountId=FOREIGN;});
 await assert.rejects(f.read('jobs'),/changed_during_read/);
});
test('F15 H2 metadata from foreign device or wrong account is never returned',async()=>{
 const f=fixture(260,{goldJobs:{async pageForOwner(){
   return {total:1,hasMore:false,rows:[{
     jobId:'j-foreign',deviceId:'foreign-dev',status:'ok',
     startedAt:1793999999999,finishedAt:1794000000000,exitCode:0
   }]};
 }}});
 await assert.rejects(f.read('jobs'),/pg_scope_invalid/);
 const g=pgHistoryFixture();
 const first=await g.read('jobs');
 await assert.rejects(g.read('sessions',first.coverage.nextCursor),/cursor_scope_mismatch/);
});
test('F15 H2 Redis-backed session snapshot is retention-limited and revocation-fenced',async()=>{
 let flushed=0;
 const sessionBacking={async flush(){flushed++;},
  retentionPolicy:()=>({snapshotTtlSeconds:604800,terminalPruneAfterMs:604800000,immutableAudit:false})};
 const f=fixture(260,{sessionBacking});
 const first=await f.read('sessions');
 assert.equal(first.coverage.source,'redis_retained_session_window');
 assert.equal(flushed,1);
 const second=await f.read('sessions',first.coverage.nextCursor);
 assert.equal(second.rows.length,100);
 assert.equal(flushed,2);
 f.sessionsRows.shift();
 await assert.rejects(f.read('sessions',second.coverage.nextCursor),/cursor_stale/);
 const g=fixture(260,{sessionBacking:{
  async flush(){g.state.valid=false;},
  retentionPolicy:()=>({snapshotTtlSeconds:604800,terminalPruneAfterMs:604800000,immutableAudit:false})}});
 await assert.rejects(g.read('sessions'),/owner_required/);
});
