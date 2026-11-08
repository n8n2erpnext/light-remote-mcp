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
export type OwnerJob = Readonly<{
  jobId:string;deviceId:string;agentId:string|null;sessionId:string|null;
  state:string;startedAt:number|null;finishedAt:number|null;exitCode:number|null;
}>;
export type OwnerEvent = Readonly<{
  deviceId:string;eventType:string;status:string;at:number|null;
}>;
export type OwnerViewportCoverage=Readonly<{returned:number;total:number;hasMore:boolean;source:'owner_bounded_viewport'}>;
export type OwnerSnapshot = Readonly<{
  state:'ready';accountId:string;asOf:number;
  account:Readonly<{email:string|null;plan:string|null;status:string;emailVerified:boolean}>;
  entitlements:Readonly<{plan:string|null;toolCallLimit:number|null}>;
  usage:Readonly<{month:string|null;toolCallsThisMonth:number|null;byDevice:ReadonlyArray<Readonly<{deviceId:string;toolCalls:number|null;onlineMs:number|null}>>}>;
  coverage:Readonly<{
    jobs:Readonly<{returned:number;total:number;hasMore:boolean;source:'in_memory_current_window'}>;
    sessions?:Readonly<{returned:number;total:number;hasMore:boolean;activeTotal:number;holdTotal:number;source:'in_memory_current_window'}>;
    devices?:OwnerViewportCoverage;
    grants?:OwnerViewportCoverage;
    usage?:OwnerViewportCoverage;
  }>|null;
  devices:ReadonlyArray<OwnerDevice>;sessions:ReadonlyArray<OwnerSession>;
  grants:ReadonlyArray<OwnerGrant>;jobs:ReadonlyArray<OwnerJob>;events:ReadonlyArray<OwnerEvent>;
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
     !Array.isArray(usage.byDevice)||usage.byDevice.length>200||
     !Array.isArray(r.jobs)||!Array.isArray(r.events)||
     r.jobs.length>200||r.events.length>200||
     r.devices.length>200||r.sessions.length>200||r.grants.length>200)return CLOSED;
  const devices:OwnerDevice[]=[],sessions:OwnerSession[]=[],grants:OwnerGrant[]=[];
  for(const value of r.devices){
    const d=record(value),deviceId=id(d?.deviceId);
    if(!d||!deviceId)return CLOSED;
    devices.push({deviceId,name:string(d.name,120),shortId:SHORT.test(String(d.shortId||''))?String(d.shortId):null,
      os:string(d.os,60),state:string(d.state,40)||'unknown',lastSeenAt:count(d.lastSeenAt)});
  }
  const owned=new Set(devices.map(d=>d.deviceId));
  const byDevice:Array<{deviceId:string;toolCalls:number|null;onlineMs:number|null}>=[];
  for(const value of usage.byDevice){
    const row=record(value),deviceId=id(row?.deviceId);
    if(!row||!deviceId||!owned.has(deviceId))return CLOSED;
    byDevice.push({deviceId,toolCalls:count(row.toolCalls),onlineMs:count(row.onlineMs)});
  }
  const month=typeof usage.month==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(usage.month)?
    usage.month:null;
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
  const jobs:OwnerJob[]=[],events:OwnerEvent[]=[];
  for(const value of r.jobs){
    const job=record(value),jobId=id(job?.jobId),deviceId=id(job?.deviceId);
    if(!job||!jobId||!deviceId||!owned.has(deviceId))return CLOSED;
    jobs.push({jobId,deviceId,agentId:id(job.agentId),sessionId:id(job.sessionId),
      state:string(job.state,32)||'unknown',startedAt:count(job.startedAt),
      finishedAt:count(job.finishedAt),
      exitCode:typeof job.exitCode==='number'&&Number.isSafeInteger(job.exitCode)?job.exitCode:null});
  }
  for(const value of r.events){
    const event=record(value),deviceId=id(event?.deviceId);
    if(!event||!deviceId||!owned.has(deviceId))return CLOSED;
    events.push({deviceId,eventType:string(event.eventType,64)||'activity',
      status:string(event.status,32)||'unknown',at:count(event.at)});
  }
  const coverageObj=record(r.coverage),jobsCoverage=record(coverageObj?.jobs),sessionsCoverage=record(coverageObj?.sessions);
  let coverage:OwnerSnapshot['coverage']=null;
  if(jobsCoverage!==null&&
    jobsCoverage.source==='in_memory_current_window'&&
    typeof jobsCoverage.hasMore==='boolean'){
    const total=count(jobsCoverage.total),returned=count(jobsCoverage.returned);
    if(total===null||returned===null||returned!==jobs.length||
       total<returned||jobsCoverage.hasMore!==(total>returned))return CLOSED;
    coverage={jobs:{returned,total,hasMore:jobsCoverage.hasMore,
      source:'in_memory_current_window'}};
  }
  if(coverageObj&&Object.prototype.hasOwnProperty.call(coverageObj,'sessions')){
    if(!coverage||!sessionsCoverage||sessionsCoverage.source!=='in_memory_current_window'||
       typeof sessionsCoverage.hasMore!=='boolean')return CLOSED;
    const total=count(sessionsCoverage.total),returned=count(sessionsCoverage.returned),
      activeTotal=count(sessionsCoverage.activeTotal),holdTotal=count(sessionsCoverage.holdTotal);
    const visibleActive=sessions.filter(s=>s.state==='active').length,
      visibleHold=sessions.filter(s=>s.state==='hold').length;
    if(total===null||returned===null||activeTotal===null||holdTotal===null||
       returned!==sessions.length||total<returned||activeTotal+holdTotal>total||
       activeTotal<visibleActive||holdTotal<visibleHold||
       sessionsCoverage.hasMore!==(total>returned)||
       (total===returned&&(activeTotal!==visibleActive||holdTotal!==visibleHold)))return CLOSED;
    coverage={...coverage,sessions:{returned,total,hasMore:sessionsCoverage.hasMore,
      activeTotal,holdTotal,source:'in_memory_current_window'}};
  }
  if(coverageObj){
    for(const [key,actual] of [
      ['devices',devices.length],['grants',grants.length],['usage',byDevice.length]
    ] as const){
      if(!Object.prototype.hasOwnProperty.call(coverageObj,key))continue;
      const part=record(coverageObj[key]);
      const returned=count(part?.returned),total=count(part?.total);
      if(!coverage||!part||part.source!=='owner_bounded_viewport'||
         typeof part.hasMore!=='boolean'||returned===null||total===null||
         returned!==actual||total<returned||part.hasMore!==(total>returned))return CLOSED;
      coverage={...coverage,[key]:{returned,total,hasMore:part.hasMore,
        source:'owner_bounded_viewport'}};
    }
  }
  return Object.freeze({state:'ready',accountId:expectedAccountId,asOf,
    account:Object.freeze({email:string(ac.email,254),plan:string(ac.plan,40),
      status:'active',emailVerified:true}),
    entitlements:Object.freeze({plan:string(ent.plan,40),toolCallLimit:count(ent.toolCallLimit)}),
    usage:Object.freeze({month,toolCallsThisMonth:count(usage.toolCallsThisMonth),byDevice}),
    coverage,devices,sessions,grants,jobs,events});
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
