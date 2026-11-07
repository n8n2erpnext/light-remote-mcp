// T06: native Desktop Owner read model. Internal Operator Unix route ONLY.
// Requires the independently verified single Owner's live Account session.
// Does not mint grants, expose secrets, or authorize commands.
const ACCOUNT=/^[A-Za-z0-9._:-]{1,128}$/;
const SESSION=/^acctsess_[a-f0-9-]{36}$/;
const string=(v,max=160)=>typeof v==='string'?v.slice(0,max):null;
const finite=(v)=>Number.isSafeInteger(v)&&v>=0?v:null;
const deny=(reason,status=403)=>{throw Object.assign(new Error(reason),{status});};
const sorted=(rows)=>rows.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
export function createDesktopV4OwnerSnapshot({
 accounts,allDeviceViews,sessions,accessGrants,usage,planEntitlements,
 jobs,recentEvents,lookupShortIds=async()=>new Map(),
 now=Date.now,maxDevices=200,maxSessions=200,maxGrants=200,maxJobs=200
}={}){
 if(!accounts?.desktopOwnerSessionActive||!accounts?.account||
    typeof allDeviceViews!=='function'||!sessions?.list||
    !accessGrants?.activeGrantsForDevice||!usage?.summary||
    !jobs?.values||typeof recentEvents!=='function'||
    typeof planEntitlements!=='function'||typeof lookupShortIds!=='function')
   deny('desktop_snapshot_dependencies_missing',503);
 return async function snapshot({accountId,accountSessionId}={}){
  if(!ACCOUNT.test(accountId||'')||!SESSION.test(accountSessionId||'')||
     !accounts.desktopOwnerSessionActive(accountId,accountSessionId))
    deny('desktop_snapshot_owner_required',403);
  const account=accounts.account(accountId);
  if(account.accountId!==accountId||account.isOwner!==true||
     account.emailVerified!==true||account.status!=='active')
    deny('desktop_snapshot_owner_required',403);
  const rawDevices=allDeviceViews().filter(d=>d.accountId===accountId);
  if(rawDevices.length>maxDevices)deny('desktop_snapshot_fleet_too_large',409);
  // The Owner account and eligible device IDs are derived from the authenticated
  // server registry, never a client-provided list. Only PG043 owns Short IDs.
  let shortIds;
  try{
   shortIds=await lookupShortIds({accountId,
    deviceIds:rawDevices.filter(d=>d.state!=='revoked').map(d=>d.deviceId)});
  }catch{deny('desktop_snapshot_short_ids_unavailable',503);}
  if(!(shortIds instanceof Map))deny('desktop_snapshot_short_id_result_invalid',503);
  const devices=rawDevices.map(d=>({
   deviceId:string(d.deviceId),name:string(d.displayName||d.deviceName||d.name||d.label,120),
   shortId:d.state!=='revoked'&&/^[0-9A-HJKMNP-TV-Z]{6}$/.test(String(shortIds.get(d.deviceId)||''))
     ?shortIds.get(d.deviceId):null,
   os:string(d.os||d.platform,60),
   state:['online','offline','revoked','disconnected','dormant'].includes(d.state)?d.state:'unknown',
   lastSeenAt:finite(d.lastSeenAt)
  })).filter(d=>d.deviceId);
  const owned=new Set(devices.map(d=>d.deviceId));
  const rawSessions=sessions.list().filter(s=>s.accountId===accountId&&owned.has(s.deviceId));
  if(rawSessions.length>maxSessions)deny('desktop_snapshot_sessions_too_large',409);
  const sessionRows=sorted(rawSessions.map(s=>({
   sessionId:string(s.sessionId),deviceId:string(s.deviceId),
   agentId:string(s.agentId),name:string(s.displayName||s.label,120),
   state:['active','hold','closed','expired'].includes(s.state)?s.state:'unknown',
   createdAt:finite(s.createdAt),lastSeenAt:finite(s.lastSeenAt),
   expiresAt:finite(s.expiresAt),holdReason:string(s.holdReason,80),
   activeJobs:Array.isArray(s.activeJobs)?Math.min(s.activeJobs.length,1000):null
  })).filter(s=>s.sessionId));
  const grants=[];
  for(const d of devices){
   for(const g of accessGrants.activeGrantsForDevice(d.deviceId)){
    if(g.accountId!==accountId||String(g.purpose||'device')!=='device')continue;
    if(grants.length>=maxGrants)deny('desktop_snapshot_grants_too_large',409);
    grants.push({grantId:string(g.grantId),deviceId:d.deviceId,
     agentId:string(g.agentId),approvedAt:finite(g.approvedAt),
     expiresAt:finite(Math.min(g.expiresAt||Infinity,g.absoluteExpiresAt||Infinity)),
     absoluteExpiresAt:finite(g.absoluteExpiresAt)});
   }
  }
  // Current in-memory job registry, not a claim of complete historical jobs.
  // Do not return scripts, cwd, stdout, stderr, notes or command metadata.
  const ownerJobs=[...jobs.values()].filter(j=>
    j.accountId===accountId&&owned.has(j.deviceId));
  // Keep the whole device/session/grant snapshot when the in-memory job ring
  // exceeds its UI window. Explicit coverage prevents calling it full history.
  const jobsHasMore=ownerJobs.length>maxJobs;
  const jobRows=ownerJobs.sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))
    .slice(0,maxJobs).map(j=>({
    jobId:string(j.id),deviceId:string(j.deviceId),agentId:string(j.agentId),
    sessionId:string(j.sessionId),
    state:['running','queued','ok','error','timeout','killed',
      'stop-requested','cancelled'].includes(j.status)?j.status:'unknown',
    startedAt:finite(j.startedAt),finishedAt:finite(j.finishedAt),
    exitCode:Number.isSafeInteger(j.exitCode)?j.exitCode:null
  })).filter(j=>j.jobId)
    .sort((a,b)=>(b.startedAt||0)-(a.startedAt||0));
  // The ring is deliberately a recent event window. Never include free-form
  // detail, payloads, filenames, command output, paths, email or tokens.
  const window=recentEvents(200);
  if(!Array.isArray(window)||window.length>200)
    deny('desktop_snapshot_events_unavailable',503);
  const events=window.filter(e=>e.accountId===accountId&&owned.has(e.deviceId))
    .map(e=>({
      deviceId:string(e.deviceId),
      eventType:typeof e.type==='string'&&/^[a-z][a-z0-9_:-]{0,63}$/.test(e.type)?e.type:'activity',
      status:typeof e.status==='string'&&/^[a-z][a-z0-9_:-]{0,31}$/.test(e.status)?e.status:'unknown',
      at:finite(typeof e.at==='string'?Date.parse(e.at):e.at)
    }));
  const rawUsage=usage.summary(accountId,{months:1});
  if(!Array.isArray(rawUsage?.devices)||rawUsage.devices.length>maxDevices)
    deny('desktop_snapshot_usage_unavailable',503);
  const usageMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(rawUsage.currentMonth||''))
    ?rawUsage.currentMonth:null;
  const byDevice=rawUsage.devices.filter(row=>owned.has(row?.deviceId))
    .map(row=>({deviceId:row.deviceId,toolCalls:finite(row.toolCalls),
      onlineMs:finite(row.onlineMs)}));
  const ent=planEntitlements(account);
  // The awaited PG043 lookup must not extend authority beyond an Owner
  // session which was revoked while the snapshot was being assembled.
  const ownerNow=accounts.account(accountId);
  if(!accounts.desktopOwnerSessionActive(accountId,accountSessionId)||
     ownerNow?.accountId!==accountId||ownerNow.isOwner!==true||
     ownerNow.emailVerified!==true||ownerNow.status!=='active')
   deny('desktop_snapshot_owner_revoked_during_read',403);
  // Typed fields only: account password hashes, registration metadata,
  // device credentials, raw workspace paths and usage internals are omitted.
  return Object.freeze({ok:true,accountId,asOf:now(),
   account:{email:string(account.email,254),plan:string(account.plan,40),
    status:'active',emailVerified:true},
   entitlements:{plan:string(ent?.plan,40),
    toolCallLimit:finite(ent?.toolCallLimit)},
   usage:{month:usageMonth,toolCallsThisMonth:finite(rawUsage?.toolCallsThisMonth),byDevice},
   coverage:{jobs:{returned:jobRows.length,total:ownerJobs.length,
    hasMore:jobsHasMore,source:'in_memory_current_window'}},
   devices,sessions:sessionRows,grants,jobs:jobRows,events});
 };
}
