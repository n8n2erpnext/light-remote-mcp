// T11-F15: Owner scoped read-only pages of monthly usage and current in-memory
// jobs/sessions. These are NOT a durable job/session audit archive.
import crypto from 'node:crypto';

const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const SESSION=/^acctsess_[a-f0-9-]{36}$/;
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const deny=(reason,status=403)=>{throw Object.assign(new Error(reason),{status});};
const finite=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const safe=(v,max=160)=>typeof v==='string'?v.slice(0,max):null;
const fingerprint=(value)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(input){
 if(typeof input!=='string'||input.length>512||input.length<10||
    !/^[A-Za-z0-9_-]+$/.test(input))deny('desktop_activity_cursor_invalid',400);
 try{
  const value=JSON.parse(Buffer.from(input,'base64url').toString('utf8'));
  if(encode(value)!==input||value?.v!==1||
     !ACCOUNT.test(value.accountId||'')||!['usage','jobs','sessions'].includes(value.kind)||
     typeof value.lastKey!=='string'||value.lastKey.length>300||
     !/^[a-f0-9]{64}$/.test(value.revision||'')||
     !Number.isSafeInteger(value.limit)||value.limit<1||value.limit>100)
   deny('desktop_activity_cursor_invalid',400);
  return value;
 }catch(e){if(e?.status)throw e;deny('desktop_activity_cursor_invalid',400);}
}
const stateOfSession=v=>['active','hold','closed','expired'].includes(v)?v:'unknown';
const stateOfJob=v=>['running','queued','ok','error','timeout','killed',
 'stop-requested','cancelled','interrupted'].includes(v)?v:'unknown';
const makeKey=(v)=>v;
export function createDesktopV4OwnerActivityPage({
 accounts,allDeviceViews,usage,sessions,jobs,goldJobs=null,sessionBacking=null,
 now=Date.now,maxPageSize=100
}={}){
 if(!accounts?.desktopOwnerSessionActive||!accounts?.account||
    typeof allDeviceViews!=='function'||!usage?.summary||!sessions?.list||!jobs?.values)
  deny('desktop_activity_dependencies_missing',503);
 return async function page({accountId,accountSessionId,page}={}){
  const checkOwner=()=>{
    if(!ACCOUNT.test(accountId||'')||!SESSION.test(accountSessionId||'')||
       !accounts.desktopOwnerSessionActive(accountId,accountSessionId))
      deny('desktop_activity_owner_required',403);
    const account=accounts.account(accountId);
    if(account?.accountId!==accountId||account.isOwner!==true||
       account.emailVerified!==true||account.status!=='active')
      deny('desktop_activity_owner_required',403);
  };
  checkOwner();
  if(!page||typeof page!=='object'||Array.isArray(page)||
     !['usage','jobs','sessions'].includes(page.kind))
    deny('desktop_activity_kind_invalid',400);
  const kind=page.kind,limit=page.limit===undefined?Math.min(100,maxPageSize):page.limit;
  if(!Number.isSafeInteger(limit)||limit<1||limit>maxPageSize||limit>100)
    deny('desktop_activity_limit_invalid',400);
  if(page.cursor!=null&&typeof page.cursor!=='string')
    deny('desktop_activity_cursor_invalid',400);
  const cursor=page.cursor?decode(page.cursor):null;
  if(cursor&&(cursor.kind!==kind||cursor.accountId!==accountId||cursor.limit!==limit))
    deny('desktop_activity_cursor_scope_mismatch',403);
  const ownerDevices=allDeviceViews({accountId})
    .filter(d=>d.accountId===accountId&&ID.test(d.deviceId||''));
  const owned=new Set(ownerDevices.filter(d=>d.state!=='revoked').map(d=>d.deviceId));
  // P05 in-memory page remains the compatibility fallback for tests and
  // environments where the Gold durable job ledger is not injected.
  if(kind==='jobs'&&goldJobs?.pageForOwner){
    const currentMembership=()=>allDeviceViews({accountId})
      .filter(d=>d.accountId===accountId&&ID.test(d.deviceId||'')&&d.state!=='revoked')
      .map(d=>[d.deviceId,d.state,String(d.revokedAt||'')])
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'en'));
    const revision=fingerprint([accountId,kind,accounts.ownerRevision??null,
      currentMembership()]);
    const anchorMs=cursor?cursor.anchorMs:now();
    if(!Number.isSafeInteger(anchorMs)||anchorMs<0||
       anchorMs>now()+60000||now()-anchorMs>3600000)
      deny('desktop_activity_cursor_expired',409);
    if(cursor&&cursor.revision!==revision)
      deny('desktop_activity_cursor_stale',409);
    const match=cursor?.lastKey?.match(/^([0-9]{1,15})~([A-Za-z0-9._:-]{1,128})$/);
    if(cursor&&!match)deny('desktop_activity_cursor_invalid',400);
    const after=match?{startedAtMs:Number(match[1]),jobId:match[2]}:null;
    const result=await goldJobs.pageForOwner({
      accountId,deviceIds:[...owned],limit,anchorMs,after
    });
    checkOwner();
    if(fingerprint([accountId,kind,accounts.ownerRevision??null,
        currentMembership()])!==revision)
      deny('desktop_activity_changed_during_read',409);
    if(!result||!Array.isArray(result.rows)||result.rows.length>limit||
       !Number.isSafeInteger(result.total)||result.total<result.rows.length||
       typeof result.hasMore!=='boolean'||
       (result.hasMore&&!result.rows.length))
      deny('desktop_activity_pg_result_invalid',503);
    const rows=result.rows.map(j=>{
      if(!ID.test(j.jobId||'')||!owned.has(j.deviceId)||
         !Number.isSafeInteger(j.startedAt)||j.startedAt>anchorMs)
        deny('desktop_activity_pg_scope_invalid',503);
      return {jobId:j.jobId,deviceId:j.deviceId,agentId:safe(j.agentId),
        sessionId:safe(j.sessionId),state:stateOfJob(j.status),
        startedAt:finite(j.startedAt),finishedAt:finite(j.finishedAt),
        exitCode:Number.isSafeInteger(j.exitCode)?j.exitCode:null};
    });
    return Object.freeze({
      ok:true,accountId,kind,asOf:now(),rows,
      coverage:{returned:rows.length,total:result.total,hasMore:result.hasMore,
        nextCursor:result.hasMore?encode({
          v:1,accountId,kind,limit,revision,anchorMs,
          lastKey:rows.at(-1).startedAt+'~'+rows.at(-1).jobId
        }):null,
        source:'postgresql_owner_job_history'}
    });
  }
  const retention=kind==='sessions'&&sessionBacking?
    sessionBacking.retentionPolicy?.(sessions):null;
  if(kind==='sessions'&&sessionBacking&&
     (!retention||retention.snapshotTtlSeconds!==604800||
      !Number.isSafeInteger(retention.terminalPruneAfterMs)||
      retention.terminalPruneAfterMs<0||
      retention.terminalPruneAfterMs>365*24*60*60*1000||
      retention.immutableAudit!==false))
    deny('desktop_activity_session_retention_unverified',503);
  // Do not trust the once-captured ownerDevices after any awaited Redis
  // persistence operation or mid-read device owner transfer.
  const membershipFingerprint=()=>fingerprint(allDeviceViews({accountId})
    .filter(d=>d.accountId===accountId&&ID.test(d.deviceId||''))
    .map(d=>[d.deviceId,d.state,d.revokedAt||null])
    .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'en')));
  const originalMembership=membershipFingerprint();
  const build=()=>{
    const rows=[];
    let month=null;
    if(kind==='usage'){
      const summary=usage.summary(accountId,{months:1});
      if(!Array.isArray(summary?.devices)||
         !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(summary.currentMonth||'')))
        deny('desktop_activity_usage_unavailable',503);
      month=summary.currentMonth;
      for(const d of summary.devices){
        if(!owned.has(d?.deviceId)||!ID.test(d.deviceId))continue;
        rows.push({key:makeKey(d.deviceId),data:{
          deviceId:d.deviceId,toolCalls:finite(d.toolCalls),onlineMs:finite(d.onlineMs)
        }});
      }
    }else if(kind==='jobs'){
      for(const j of jobs.values()){
        if(j.accountId!==accountId||!owned.has(j.deviceId)||
           !ID.test(j.id||''))continue;
        rows.push({key:makeKey(j.id),data:{
          jobId:j.id,deviceId:j.deviceId,agentId:safe(j.agentId),
          sessionId:safe(j.sessionId),state:stateOfJob(j.status),
          startedAt:finite(j.startedAt),finishedAt:finite(j.finishedAt),
          exitCode:Number.isSafeInteger(j.exitCode)?j.exitCode:null
        }});
      }
    }else{
      for(const s of sessions.list()){
        if(s.accountId!==accountId||!owned.has(s.deviceId)||
           !ID.test(s.sessionId||''))continue;
        rows.push({key:makeKey(s.sessionId),data:{
          sessionId:s.sessionId,deviceId:s.deviceId,agentId:safe(s.agentId),
          name:safe(s.displayName||s.label,120),state:stateOfSession(s.state),
          createdAt:finite(s.createdAt),lastSeenAt:finite(s.lastSeenAt),
          expiresAt:finite(s.expiresAt),holdReason:safe(s.holdReason,80),
          activeJobs:Array.isArray(s.activeJobs)?Math.min(s.activeJobs.length,1000):null
        }});
      }
    }
    rows.sort((a,b)=>a.key.localeCompare(b.key,'en'));
    if(new Set(rows.map(x=>x.key)).size!==rows.length)
      deny('desktop_activity_duplicate_key',503);
    const membership=ownerDevices.map(d=>[d.deviceId,d.state,d.revokedAt||null])
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'en'));
    const revision=fingerprint([accountId,kind,month,accounts.ownerRevision??null,
      membership,rows.map(r=>r.key)]);
    return {rows,revision,month};
  };
  const current=build();
  if(cursor&&cursor.revision!==current.revision)
    deny('desktop_activity_cursor_stale',409);
  const start=cursor?current.rows.findIndex(r=>r.key===cursor.lastKey)+1:0;
  if(cursor&&start===0)deny('desktop_activity_cursor_invalid',400);
  const window=current.rows.slice(start,start+limit);
  // Recheck after scheduling, even for today-sync in-memory sources. A later
  // persistent store can replace rows without changing the Owner protocol.
  await Promise.resolve();
  checkOwner();
  if(membershipFingerprint()!==originalMembership||
     build().revision!==current.revision)
    deny('desktop_activity_changed_during_read',409);
  // sessions.list() prunes closed/expired entries; flush that tombstone
  // before claiming an Owner read is complete, including across restarts.
  if(kind==='sessions'&&sessionBacking){
    await sessionBacking.flush();
    checkOwner();
    if(membershipFingerprint()!==originalMembership||
       build().revision!==current.revision)
      deny('desktop_activity_changed_during_read',409);
  }
  const hasMore=start+window.length<current.rows.length;
  return Object.freeze({
    ok:true,accountId,kind,asOf:now(),rows:window.map(x=>x.data),
    coverage:{returned:window.length,total:current.rows.length,hasMore,
     nextCursor:hasMore?encode({v:1,accountId,kind,lastKey:window.at(-1).key,
        revision:current.revision,limit}):null,
     source:kind==='usage'?'owner_current_month_usage':
       kind==='sessions'&&sessionBacking?'redis_retained_session_window':
       'in_memory_current_window',
     ...(retention?{retention}: {})},
    ...(kind==='usage'?{month:current.month}:{})
  });
 };
}
