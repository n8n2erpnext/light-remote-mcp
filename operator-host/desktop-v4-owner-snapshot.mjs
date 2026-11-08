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
  const rawDevices=allDeviceViews({accountId}).filter(d=>d.accountId===accountId);
  // The base read is a bounded viewport, not a complete fleet declaration.
  // F14 native pages carry the complete account-scoped device/grant inventory.
  const visibleRawDevices=rawDevices.slice(0,maxDevices);
  const allOwned=new Set(rawDevices.map(d=>d.deviceId));
  // The Owner account and eligible device IDs are derived from the authenticated
  // server registry, never a client-provided list. Only PG043 owns Short IDs.
  let shortIds;
  try{
   shortIds=await lookupShortIds({accountId,
    deviceIds:visibleRawDevices.filter(d=>d.state!=='revoked').map(d=>d.deviceId)});
  }catch{deny('desktop_snapshot_short_ids_unavailable',503);}
  if(!(shortIds instanceof Map))deny('desktop_snapshot_short_id_result_invalid',503);
  const devices=visibleRawDevices.map(d=>({
   deviceId:string(d.deviceId),name:string(d.displayName||d.deviceName||d.name||d.label,120),
   shortId:d.state!=='revoked'&&/^[0-9A-HJKMNP-TV-Z]{6}$/.test(String(shortIds.get(d.deviceId)||''))
     ?shortIds.get(d.deviceId):null,
   os:string(d.os||d.platform,60),
   state:['online','offline','revoked','disconnected','dormant'].includes(d.state)?d.state:'unknown',
   lastSeenAt:finite(d.lastSeenAt)
  })).filter(d=>d.deviceId);
  const owned=new Set(devices.map(d=>d.deviceId));
  const rawSessions=sessions.list().filter(s=>s.accountId===accountId&&allOwned.has(s.deviceId));
  // Session history is bounded independently of device/grant authority. A large
  // completed-session history must not hide all verified Owner devices/leases.
  // If a window is needed, put active/held leases before closed history.
  const sessionLiveTotal=rawSessions.filter(s=>s.state==='active').length;
  const sessionHoldTotal=rawSessions.filter(s=>s.state==='hold').length;
  const visibleSessions=rawSessions.filter(s=>owned.has(s.deviceId));
  const sessionsTruncated=rawSessions.length>maxSessions||visibleSessions.length!==rawSessions.length;
  const sessionWindow=sessionsTruncated?[...visibleSessions].sort((a,b)=>
   Number(b.state==='active'||b.state==='hold')-Number(a.state==='active'||a.state==='hold')||
   (b.createdAt||0)-(a.createdAt||0)).slice(0,maxSessions):visibleSessions;
  const sessionRows=sorted(sessionWindow.map(s=>({
   sessionId:string(s.sessionId),deviceId:string(s.deviceId),
   agentId:string(s.agentId),name:string(s.displayName||s.label,120),
   state:['active','hold','closed','expired'].includes(s.state)?s.state:'unknown',
   createdAt:finite(s.createdAt),lastSeenAt:finite(s.lastSeenAt),
   expiresAt:finite(s.expiresAt),holdReason:string(s.holdReason,80),
   activeJobs:Array.isArray(s.activeJobs)?Math.min(s.activeJobs.length,1000):null
  })).filter(s=>s.sessionId));
  const byDeviceGrants=typeof accessGrants.activeGrantsForDevices==='function'
   ? accessGrants.activeGrantsForDevices(rawDevices.filter(d=>d.state!=='revoked').map(d=>d.deviceId)):null;
  if(byDeviceGrants!==null&&!(byDeviceGrants instanceof Map))deny('desktop_snapshot_grants_unavailable',503);
  const grants=[];let grantsTotal=0;
  for(const d of rawDevices){
   if(d.state==='revoked')continue;
   const list=byDeviceGrants===null?accessGrants.activeGrantsForDevice(d.deviceId):byDeviceGrants.get(d.deviceId)||[];
   if(!Array.isArray(list))deny('desktop_snapshot_grants_unavailable',503);
   for(const g of list){
    if(g.accountId!==accountId||g.deviceId!==d.deviceId||
       String(g.purpose||'device')!=='device')continue;
    grantsTotal++;
    if(!owned.has(d.deviceId)||grants.length>=maxGrants)continue;
    grants.push({grantId:string(g.grantId),deviceId:d.deviceId,
     agentId:string(g.agentId),approvedAt:finite(g.approvedAt),
     expiresAt:finite(Math.min(g.expiresAt||Infinity,g.absoluteExpiresAt||Infinity)),
     absoluteExpiresAt:finite(g.absoluteExpiresAt)});
   }
  }
  // Current in-memory job registry, not a claim of complete historical jobs.
  // Do not return scripts, cwd, stdout, stderr, notes or command metadata.
  const ownerJobs=[...jobs.values()].filter(j=>
    j.accountId===accountId&&allOwned.has(j.deviceId));
  const visibleJobs=ownerJobs.filter(j=>owned.has(j.deviceId));
  // Keep the whole device/session/grant snapshot when the in-memory job ring
  // exceeds its UI window. Explicit coverage prevents calling it full history.
  const jobsHasMore=ownerJobs.length>maxJobs||visibleJobs.length!==ownerJobs.length;
  const jobRows=visibleJobs.sort((a,b)=>(b.startedAt||0)-(a.startedAt||0))
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
  if(!Array.isArray(rawUsage?.devices))
    deny('desktop_snapshot_usage_unavailable',503);
  const ownedUsage=rawUsage.devices.filter(row=>allOwned.has(row?.deviceId));
  const usageMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(String(rawUsage.currentMonth||''))
    ?rawUsage.currentMonth:null;
  const byDevice=ownedUsage.filter(row=>owned.has(row?.deviceId)).slice(0,maxDevices)
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
    hasMore:jobsHasMore,source:'in_memory_current_window'},
    devices:{returned:devices.length,total:rawDevices.length,
     hasMore:devices.length<rawDevices.length,source:'owner_bounded_viewport'},
    grants:{returned:grants.length,total:grantsTotal,
     hasMore:grants.length<grantsTotal,source:'owner_bounded_viewport'},
    usage:{returned:byDevice.length,total:ownedUsage.length,
     hasMore:byDevice.length<ownedUsage.length,source:'owner_bounded_viewport'},
    sessions:{returned:sessionRows.length,total:rawSessions.length,
     hasMore:rawSessions.length>sessionRows.length,activeTotal:sessionLiveTotal,
     holdTotal:sessionHoldTotal,source:'in_memory_current_window'}},
   devices,sessions:sessionRows,grants,jobs:jobRows,events});
 };
}
