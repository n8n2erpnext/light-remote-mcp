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
 now=Date.now,maxDevices=200,maxSessions=200,maxGrants=200
}={}){
 if(!accounts?.desktopOwnerSessionActive||!accounts?.account||
    typeof allDeviceViews!=='function'||!sessions?.list||
    !accessGrants?.activeGrantsForDevice||!usage?.summary||
    typeof planEntitlements!=='function')deny('desktop_snapshot_dependencies_missing',503);
 return function snapshot({accountId,accountSessionId}={}){
  if(!ACCOUNT.test(accountId||'')||!SESSION.test(accountSessionId||'')||
     !accounts.desktopOwnerSessionActive(accountId,accountSessionId))
    deny('desktop_snapshot_owner_required',403);
  const account=accounts.account(accountId);
  if(account.accountId!==accountId||account.isOwner!==true||
     account.emailVerified!==true||account.status!=='active')
    deny('desktop_snapshot_owner_required',403);
  const rawDevices=allDeviceViews().filter(d=>d.accountId===accountId);
  if(rawDevices.length>maxDevices)deny('desktop_snapshot_fleet_too_large',409);
  const devices=rawDevices.map(d=>({
   deviceId:string(d.deviceId),name:string(d.deviceName||d.name||d.label,120),
   shortId:typeof d.shortId==='string'&&/^[0-9A-HJKMNP-TV-Z]{6}$/.test(d.shortId)?d.shortId:null,
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
  const rawUsage=usage.summary(accountId,{months:1});
  const ent=planEntitlements(account);
  // Typed fields only: account password hashes, registration metadata,
  // device credentials, raw workspace paths and usage internals are omitted.
  return Object.freeze({ok:true,accountId,asOf:now(),
   account:{email:string(account.email,254),plan:string(account.plan,40),
    status:'active',emailVerified:true},
   entitlements:{plan:string(ent?.plan,40),
    toolCallLimit:finite(ent?.toolCallLimit)},
   usage:{toolCallsThisMonth:finite(rawUsage?.toolCallsThisMonth)},
   devices,sessions:sessionRows,grants});
 };
}
