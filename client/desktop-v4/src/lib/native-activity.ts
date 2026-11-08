// T11-F15: Owner activity is read only. Browser controls send only kind/cursor
// over the existing native IPC, never an Owner token or account selector.
import type {OwnerJob,OwnerSession} from './native-snapshot';
import {nativeOwnerSnapshotAvailable} from './native-snapshot';
export type ActivityKind='usage'|'jobs'|'sessions';
export type UsageDeviceRow=Readonly<{deviceId:string;toolCalls:number|null;onlineMs:number|null}>;
export type SessionRetention=Readonly<{
 snapshotTtlSeconds:number;terminalPruneAfterMs:number;immutableAudit:false
}>;
export type ActivityCoverage=Readonly<{
 returned:number;total:number;hasMore:boolean;nextCursor:string|null;
 retention?:SessionRetention;
 source:'owner_current_month_usage'|'in_memory_current_window'|'postgresql_owner_job_history'|'redis_retained_session_window'
}>;
export type ActivityPage=
 | Readonly<{state:'ready';kind:'usage';accountId:string;asOf:number;month:string;
   rows:ReadonlyArray<UsageDeviceRow>;coverage:ActivityCoverage}>
 | Readonly<{state:'ready';kind:'jobs';accountId:string;asOf:number;
   rows:ReadonlyArray<OwnerJob>;coverage:ActivityCoverage}>
 | Readonly<{state:'ready';kind:'sessions';accountId:string;asOf:number;
   rows:ReadonlyArray<OwnerSession>;coverage:ActivityCoverage}>;
export type ActivityView=ActivityPage|Readonly<{state:'unavailable';reason:string}>;
const CLOSED:ActivityView=Object.freeze({state:'unavailable',reason:'owner_activity_unavailable'});
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const CURSOR=/^[A-Za-z0-9_-]{10,512}$/;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const id=(v:unknown)=>typeof v==='string'&&ID.test(v)?v:null;
const str=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max?v:null;
const record=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function projectOwnerActivityPage(input:unknown,accountId:string,kind:ActivityKind):ActivityView{
 const body=record(input),coverage=record(body?.coverage),rows=body?.rows;
 if(!id(accountId)||!['usage','jobs','sessions'].includes(kind)||body?.ok!==true||
    body.accountId!==accountId||body.kind!==kind||count(body.asOf)===null||
    !Array.isArray(rows)||rows.length>100||!coverage)return CLOSED;
 const returned=count(coverage.returned),total=count(coverage.total),more=coverage.hasMore,
  nextCursor=coverage.nextCursor;
 const source:ActivityCoverage['source']=kind==='usage'?'owner_current_month_usage':'in_memory_current_window';
 const allowed=kind==='jobs'?['postgresql_owner_job_history','in_memory_current_window']:
   kind==='sessions'?['redis_retained_session_window','in_memory_current_window']:
   ['owner_current_month_usage'];
 const redisSession=kind==='sessions'&&coverage.source==='redis_retained_session_window';
 const r=record(coverage.retention);
 if(redisSession?
    (!r||r.snapshotTtlSeconds!==604800||
     count(r.terminalPruneAfterMs)===null||
     (count(r.terminalPruneAfterMs)??Infinity)>365*24*60*60*1000||
     r.immutableAudit!==false):
    coverage.retention!==undefined)return CLOSED;
 if(returned===null||total===null||returned!==rows.length||returned>total||
    typeof more!=='boolean'||!allowed.includes(String(coverage.source))||
    (more&&(!nextCursor||typeof nextCursor!=='string'||!CURSOR.test(nextCursor)||!rows.length))||
    (!more&&nextCursor!==null)|| (kind==='usage'&&!MONTH.test(String(body.month||''))))
   return CLOSED;
 const common={state:'ready' as const,kind,accountId,asOf:count(body.asOf)!,
  coverage:{returned,total,hasMore:more,nextCursor:more?String(nextCursor):null,
    source:coverage.source as ActivityCoverage['source'],
    ...(redisSession?{retention:{
       snapshotTtlSeconds:604800,
       terminalPruneAfterMs:count(r!.terminalPruneAfterMs)!,
       immutableAudit:false as const
    }}:{})}};
 const keys=new Set<string>();
 if(kind==='usage'){
  const out:UsageDeviceRow[]=[];
  for(const item of rows){
   const x=record(item),deviceId=id(x?.deviceId);
   if(!x||!deviceId||keys.has(deviceId))return CLOSED;
   keys.add(deviceId);
   out.push({deviceId,toolCalls:count(x.toolCalls),onlineMs:count(x.onlineMs)});
  }
  return {...common,kind,month:String(body.month),rows:out};
 }
 if(kind==='jobs'){
  const out:OwnerJob[]=[];
  for(const item of rows){
   const x=record(item),jobId=id(x?.jobId),deviceId=id(x?.deviceId);
   if(!x||!jobId||!deviceId||keys.has(jobId))return CLOSED;
   keys.add(jobId);
   out.push({jobId,deviceId,agentId:id(x.agentId),sessionId:id(x.sessionId),
    state:str(x.state,32)||'unknown',startedAt:count(x.startedAt),
    finishedAt:count(x.finishedAt),
    exitCode:typeof x.exitCode==='number'&&Number.isSafeInteger(x.exitCode)?x.exitCode:null});
  }
  return {...common,kind,rows:out};
 }
 const out:OwnerSession[]=[];
 for(const item of rows){
  const x=record(item),sessionId=id(x?.sessionId),deviceId=id(x?.deviceId);
  if(!x||!sessionId||!deviceId||keys.has(sessionId))return CLOSED;
  keys.add(sessionId);
  out.push({sessionId,deviceId,agentId:id(x.agentId),name:str(x.name,120),
   state:['active','hold','closed','expired'].includes(String(x.state))?
    x.state as OwnerSession['state']:'unknown',
   createdAt:count(x.createdAt),lastSeenAt:count(x.lastSeenAt),
   expiresAt:count(x.expiresAt),holdReason:str(x.holdReason,80),
   activeJobs:count(x.activeJobs)});
 }
 return {...common,kind,rows:out};
}
type NativeWindow=Window & {__TAURI_INTERNALS__?:{invoke?:(cmd:string,args?:unknown)=>Promise<unknown>}};
export async function nativeOwnerActivityPage(
 accountId:string,kind:ActivityKind,cursor:string|null=null,host:Window=window
):Promise<ActivityView>{
 if(!nativeOwnerSnapshotAvailable(host)||!id(accountId)||
    !['usage','jobs','sessions'].includes(kind)||
    (cursor!==null&&!CURSOR.test(cursor)))return CLOSED;
 try{
  const raw=await (host as NativeWindow).__TAURI_INTERNALS__!.invoke!(
   'desktop_owner_inventory_page',{kind,cursor});
  return projectOwnerActivityPage(raw,accountId,kind);
 }catch{return CLOSED;}
}
