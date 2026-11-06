/**
 * T06 Owner-scoped signed-backend read model. Native Rust owns the bearer.
 * React gets a bounded, typed allowlist; never credentials or raw jobs.
 */
export type OwnerDevice = Readonly<{
  deviceId:string;name:string|null;shortId:string|null;os:string|null;
  state:string;lastSeenAt:number|null;
}>;
export type OwnerSession = Readonly<{
  sessionId:string;deviceId:string;agentId:string|null;name:string|null;
  state:'active'|'hold'|'closed'|'expired'|'unknown';
  createdAt:number|null;lastSeenAt:number|null;expiresAt:number|null;
  holdReason:string|null;activeJobs:number|null;
}>;
export type OwnerGrant = Readonly<{
  grantId:string;deviceId:string;agentId:string|null;
  approvedAt:number|null;expiresAt:number|null;absoluteExpiresAt:number|null;
}>;
export type OwnerSnapshot = Readonly<{
  state:'ready';accountId:string;asOf:number;
  account:Readonly<{email:string|null;plan:string|null;status:string;emailVerified:boolean}>;
  entitlements:Readonly<{plan:string|null;toolCallLimit:number|null}>;
  usage:Readonly<{toolCallsThisMonth:number|null}>;
  devices:ReadonlyArray<OwnerDevice>;sessions:ReadonlyArray<OwnerSession>;
  grants:ReadonlyArray<OwnerGrant>;
}>;
export type SnapshotView=OwnerSnapshot | Readonly<{state:'unavailable';reason:string}>;
const CLOSED:SnapshotView=Object.freeze({state:'unavailable',reason:'owner_api_unavailable'});
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const SID=/^[A-Za-z0-9._:-]{1,160}$/;
const SHORT=/^[0-9A-HJKMNP-TV-Z]{6}$/;
const string=(v:unknown,max=160)=>typeof v==='string'&&v.length<=max?v:null;
const id=(v:unknown)=>typeof v==='string'&&ID.test(v)?v:null;
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const record=(v:unknown):Record<string,unknown>|null=>
  v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function projectOwnerSnapshot(input:unknown,expectedAccountId:string):SnapshotView{
  const r=record(input),ac=record(r?.account),ent=record(r?.entitlements),
    usage=record(r?.usage),asOf=count(r?.asOf);
  if(r?.ok!==true||!id(expectedAccountId)||r.accountId!==expectedAccountId||
     asOf===null||!ac||ac.emailVerified!==true||ac.status!=='active'||!ent||!usage||
     !Array.isArray(r.devices)||!Array.isArray(r.sessions)||!Array.isArray(r.grants)||
     r.devices.length>200||r.sessions.length>200||r.grants.length>200)return CLOSED;
  const devices:OwnerDevice[]=[],sessions:OwnerSession[]=[],grants:OwnerGrant[]=[];
  for(const value of r.devices){
    const d=record(value),deviceId=id(d?.deviceId);
    if(!d||!deviceId)return CLOSED;
    devices.push({deviceId,name:string(d.name,120),shortId:SHORT.test(String(d.shortId||''))?String(d.shortId):null,
      os:string(d.os,60),state:string(d.state,40)||'unknown',lastSeenAt:count(d.lastSeenAt)});
  }
  const owned=new Set(devices.map(d=>d.deviceId));
  for(const value of r.sessions){
    const s=record(value),sessionId=id(s?.sessionId),deviceId=id(s?.deviceId);
    if(!s||!sessionId||!deviceId||!owned.has(deviceId))return CLOSED;
    const state=['active','hold','closed','expired'].includes(String(s.state))?
      s.state as OwnerSession['state']:'unknown';
    sessions.push({sessionId,deviceId,agentId:id(s.agentId),name:string(s.name,120),
      state,createdAt:count(s.createdAt),lastSeenAt:count(s.lastSeenAt),
      expiresAt:count(s.expiresAt),holdReason:string(s.holdReason,80),
      activeJobs:count(s.activeJobs)});
  }
  for(const value of r.grants){
    const g=record(value),grantId=id(g?.grantId),deviceId=id(g?.deviceId);
    if(!g||!grantId||!deviceId||!owned.has(deviceId))return CLOSED;
    grants.push({grantId,deviceId,agentId:id(g.agentId),
      approvedAt:count(g.approvedAt),expiresAt:count(g.expiresAt),
      absoluteExpiresAt:count(g.absoluteExpiresAt)});
  }
  return Object.freeze({state:'ready',accountId:expectedAccountId,asOf,
    account:Object.freeze({email:string(ac.email,254),plan:string(ac.plan,40),
      status:'active',emailVerified:true}),
    entitlements:Object.freeze({plan:string(ent.plan,40),toolCallLimit:count(ent.toolCallLimit)}),
    usage:Object.freeze({toolCallsThisMonth:count(usage.toolCallsThisMonth)}),
    devices,sessions,grants});
}
type NativeWindow=Window & {__TAURI_INTERNALS__?:{invoke?:(cmd:string)=>Promise<unknown>}};
export function nativeOwnerSnapshotAvailable(host:Window=window){
  return import.meta.env.VITE_LR_V4_OWNER_LOGIN==='1' &&
    import.meta.env.VITE_LR_V4_OWNER_SNAPSHOT==='1' &&
    typeof (host as NativeWindow).__TAURI_INTERNALS__?.invoke==='function';
}
export async function nativeOwnerSnapshot(accountId:string,host:Window=window):Promise<SnapshotView>{
  if(!nativeOwnerSnapshotAvailable(host))return CLOSED;
  try{
    const response=await (host as NativeWindow).__TAURI_INTERNALS__!.invoke!('desktop_owner_snapshot');
    return projectOwnerSnapshot(response,accountId);
  }catch{return CLOSED;}
}
