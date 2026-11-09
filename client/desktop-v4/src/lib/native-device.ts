import {useCallback,useEffect,useRef,useState} from 'react';
import {startScopedReadPoller,type ScopedReadPoller} from './scoped-read-poller';

export type DeviceSection='device.read'|'memory.read'|'codex.read'|'settings.read';
export type DeviceAction=DeviceSection|'device.connect'|'device.disconnect'|'module.configure'|'memory.create'|'memory.capture'|'memory.archive'|
 'memory.restore'|'memory.delete-local'|'memory.delete-account'|'memory.sync-policy'|'memory.sync-manual'|
 'codex.task-create'|'codex.task-edit'|'codex.task-state'|'codex.task-delete'|'codex.runtime-install'|
 'codex.runtime-remove'|'codex.login'|'codex.login-cancel'|'codex.logout'|'codex.account'|'codex.observe'|
 'codex.delegate'|'codex.pause'|'sessions.close'|'jobs.cancel'|'logs.configure'|'logs.clean';
type Modules=Readonly<{longMemory:boolean;codexBridge:boolean;revision:number}>;
export type LocalDevice=Readonly<{deviceName:string|null;cloudDesiredConnected:boolean;cloudState:string|null;
 version:string|null;platform:string|null;executorReady:boolean|null;policy:{profile:string|null;revision:number|null;effectiveCapabilities:string[];deniedCapabilities:string[]}}>;
type Coverage=Readonly<{returned:number;total:number}>;
export type MemoryScope=Readonly<{scopeId:string;displayName:string;homeDeviceId:string;status:string;tombstoned:boolean;
 captureMode:string;revision:number|null;checkpoints:number|null;bytes:number|null;lastConfirmedSyncAt:number|null}>;
export type SyncDevice=Readonly<{deviceId:string;name:string|null;state:string|null;online:boolean}>;
export type SyncPolicy=Readonly<{enabled:boolean;revision:number;devices:ReadonlyArray<{deviceId:string;selected:boolean;mode:string;manualRequestSeq:number|null}>}>;
export type MemoryView=Readonly<{localFileBytes:number|null;liveBytes:number|null;checkpointBytes:number|null;coverage:Coverage|null;
 lastConfirmedSyncAt:number|null;scopes:ReadonlyArray<MemoryScope>;sync:{state:'ready'|'unavailable';currentDeviceId?:string;devices?:ReadonlyArray<SyncDevice>;policy?:SyncPolicy}}>;
export type CodexTask=Readonly<{id:string;title:string;state:string;createdAt:number|null;changedAt:number}>;
export type CodexView=Readonly<{tasks:ReadonlyArray<CodexTask>;recommendation:string|null;coverage:Coverage|null;
 runtime:{state:string|null;installed:boolean;externalAvailable:boolean;installing:boolean;lastError:string|null};
 operation:{state:string;error:string|null}|null;delegations:ReadonlyArray<{taskId:string;state:string;decision:string|null;maxRounds:number|null;rounds:number|null}>}>;
export type DeviceView=Readonly<{asOf:number|null;modules:Modules|null;device:LocalDevice|null;memory:MemoryView|null;
 codex:CodexView|null;activityLog:{preset:string;usedBytes:number;maxDiskBytes:number;ramEvents:number}|null;
 operation:Readonly<{state:string|null;requested:boolean;saved:boolean;connected:boolean|null;userCode:string|null;plan:string|null}>}>;
export type DeviceReply=Readonly<{state:'ready';accountId:string;deviceId:string;view:DeviceView}>|
 Readonly<{state:'unavailable';reason:string}>;
const closed=(reason='desktop_device_unavailable'):DeviceReply=>({state:'unavailable',reason});
const object=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:null;
const string=(x:unknown,max=240)=>typeof x==='string'&&x.length<=max?x:null;
const count=(x:unknown):number|null=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0?x:null;
const id=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(x);
const rows=(x:unknown)=>Array.isArray(x)&&x.length<=100?x:[];
const list=(x:unknown)=>rows(x).filter((r):r is string=>typeof r==='string'&&r.length<=160);
const coverage=(x:unknown):Coverage|null=>{const c=object(x);return c&&count(c.returned)!==null&&count(c.total)!==null&&Number(c.total)>=Number(c.returned)?{returned:Number(c.returned),total:Number(c.total)}:null;};
const sensitive=(x:unknown):boolean=>{
 if(Array.isArray(x))return x.some(sensitive);
 const r=object(x);return r!==null&&Object.entries(r).some(([k,v])=>
  ['access','access_token','refresh_token','privateKey','privateIdentityKey','memoryIdentity','publicIdentityKey','deviceToken','cookie','csrf'].includes(k)||sensitive(v));
};
export function projectDeviceReply(input:unknown,accountId:string,deviceId:string|null=null):DeviceReply{
 const r=object(input),v=object(r?.view),m=object(v?.modules);
 if(r?.ok!==true||r.accountId!==accountId||!id(accountId)||!id(r.deviceId)||
  (deviceId!==null&&r.deviceId!==deviceId)||!v||sensitive(r))return closed();
 let modules:Modules|null=null;
 if(m){
  const revision=count(m.revision);
  if(revision===null||typeof m.longMemory!=='boolean'||typeof m.codexBridge!=='boolean')return closed('desktop_module_state_invalid');
  modules={longMemory:m.longMemory,codexBridge:m.codexBridge,revision};
 }
 let device:LocalDevice|null=null;
 const d=object(v.device),p=object(d?.policy);
 if(d)device={deviceName:string(d.deviceName,120),cloudDesiredConnected:d.cloudDesiredConnected===true,
  cloudState:string(d.cloudState,40),version:string(d.version,40),platform:string(d.platform,40),executorReady:typeof d.executorReady==='boolean'?d.executorReady:null,
  policy:{profile:string(p?.profile,40),revision:count(p?.revision),effectiveCapabilities:list(p?.effectiveCapabilities),deniedCapabilities:list(p?.deniedCapabilities)}};
 let memory:MemoryView|null=null;
 const mem=object(v.memory);
 if(mem){
  if(!Array.isArray(mem.scopes)||mem.scopes.length>100)return closed('desktop_memory_state_invalid');
  const scopes:MemoryScope[]=[];
  for(const value of rows(mem.scopes)){
   const s=object(value);if(!s||!id(s.scopeId)||!id(s.homeDeviceId)||!string(s.displayName))return closed('desktop_memory_state_invalid');
   scopes.push({scopeId:s.scopeId,displayName:String(s.displayName),homeDeviceId:s.homeDeviceId,
    status:string(s.status,40)||'unknown',tombstoned:s.tombstoned===true,captureMode:string(s.captureMode,40)||'unknown',
    revision:count(s.revision),checkpoints:count(s.checkpoints),bytes:count(s.bytes),lastConfirmedSyncAt:count(s.lastConfirmedSyncAt)});
  }
  let sync:MemoryView['sync']={state:'unavailable'};
  const sy=object(mem.sync),policy=object(sy?.policy);
  if(sy?.state==='ready'&&id(sy.currentDeviceId)&&policy&&typeof policy.enabled==='boolean'&&count(policy.revision)!==null){
   if(!Array.isArray(sy.devices)||sy.devices.length>100||!Array.isArray(policy.devices)||policy.devices.length>100)return closed('desktop_sync_state_invalid');
   const devices:SyncDevice[]=[],entries:Array<{deviceId:string;selected:boolean;mode:string;manualRequestSeq:number|null}>=[];
   for(const value of rows(sy.devices)){
    const x=object(value);if(!x||!id(x.deviceId))return closed('desktop_sync_state_invalid');
    devices.push({deviceId:x.deviceId,name:string(x.name,120),state:string(x.state,40),online:x.online===true});
   }
   const owned=new Set(devices.map(x=>x.deviceId));
   for(const value of rows(policy.devices)){
    const x=object(value);if(!x||!id(x.deviceId)||!owned.has(x.deviceId)||typeof x.selected!=='boolean'||
     !['auto','follow_project','manual'].includes(String(x.mode)))return closed('desktop_sync_state_invalid');
    entries.push({deviceId:x.deviceId,selected:x.selected,mode:String(x.mode),manualRequestSeq:count(x.manualRequestSeq)});
   }
   sync={state:'ready',currentDeviceId:sy.currentDeviceId,devices,
    policy:{enabled:policy.enabled,revision:Number(policy.revision),devices:entries}};
  }
  memory={localFileBytes:count(mem.localFileBytes),liveBytes:count(mem.liveBytes),checkpointBytes:count(mem.checkpointBytes),coverage:coverage(mem.coverage),
   lastConfirmedSyncAt:count(mem.lastConfirmedSyncAt),scopes,sync};
 }
 let codex:CodexView|null=null;
 const c=object(v.codex),rt=object(c?.runtime),op=object(c?.operation);
 if(c&&rt){
  if(!Array.isArray(c.tasks)||c.tasks.length>100||!Array.isArray(c.delegations)||c.delegations.length>100)return closed('desktop_codex_state_invalid');
  const tasks:CodexTask[]=[];
  for(const value of rows(c.tasks)){
   const t=object(value);if(!t||!id(t.id)||!string(t.title)||count(t.changedAt)===null)return closed('desktop_codex_state_invalid');
   tasks.push({id:t.id,title:String(t.title),state:string(t.state,40)||'unknown',createdAt:count(t.createdAt),changedAt:Number(t.changedAt)});
  }
  const delegations:CodexView['delegations']=rows(c.delegations).flatMap(value=>{
   const x=object(value);return x&&id(x.taskId)?[{taskId:x.taskId,state:string(x.state,40)||'unknown',
    decision:string(x.decision,50),maxRounds:count(x.maxRounds),rounds:count(x.rounds)}]:[];
  });
  codex={tasks,recommendation:string(c.recommendation,50),coverage:coverage(c.coverage),runtime:{state:string(rt.state,40),installed:rt.installed===true,
   externalAvailable:rt.externalAvailable===true,installing:rt.installing===true,lastError:string(rt.lastError,160)},
   operation:op?{state:string(op.state,40)||'unknown',error:string(op.error,160)}:null,delegations};
 }
 const log=object(v.activityLog);
 const activityLog=log&&['compact','standard','extended'].includes(String(log.preset))&&
  [log.usedBytes,log.maxDiskBytes,log.ramEvents].every(x=>count(x)!==null)?{
   preset:String(log.preset),usedBytes:Number(log.usedBytes),maxDiskBytes:Number(log.maxDiskBytes),ramEvents:Number(log.ramEvents)}:null;
 return {state:'ready',accountId,deviceId:r.deviceId,view:{asOf:count(v.asOf),modules,device,memory,codex,activityLog,
  operation:{state:string(v.state,40),requested:v.requested===true||v.scheduled===true||String(v.state||'').endsWith('_requested'),saved:v.saved===true,
   connected:typeof v.connected==='boolean'?v.connected:null,userCode:string(v.userCode,48),plan:string(v.plan,40)}}};
}
type Host=Window&{__TAURI_INTERNALS__?:{invoke?:(command:string,args:Record<string,unknown>)=>Promise<unknown>}};
export function nativeDeviceAvailable(host:Window=window){
 return import.meta.env.VITE_LR_V4_OWNER_LOGIN==='1'&&typeof (host as Host).__TAURI_INTERNALS__?.invoke==='function';
}
export async function nativeDeviceRequest(action:DeviceAction,accountId:string,deviceId:string|null,payload:Record<string,unknown>={},host:Window=window):Promise<DeviceReply>{
 if(!nativeDeviceAvailable(host)||!id(accountId)||(action!=='device.read'&&!id(deviceId)))return closed();
 try{
  const value=await (host as Host).__TAURI_INTERNALS__!.invoke!('desktop_owner_device_request',{action,expectedAccountId:accountId,deviceId,payload});
  const projected=projectDeviceReply(value,accountId,deviceId);
  if(action.endsWith('.read')&&projected.state==='ready'){
   const v=projected.view;
   if(!v.modules||v.asOf===null||
    ((action==='device.read'||action==='settings.read')&&!v.device)||
    (action==='memory.read'&&v.modules.longMemory&&!v.memory)||
    (action==='codex.read'&&v.modules.codexBridge&&!v.codex))return closed('desktop_api_contract_mismatch');
  }
  return projected;
 }catch(error){
  const reason=typeof error==='string'?error:error instanceof Error?error.message:'';
  return closed(/^(?:desktop|gold|memory|codex)_[a-z0-9_]{1,100}$/.test(reason)?reason:'desktop_device_unavailable');
 }
}
export function deviceErrorMessage(reason:string){
 if(/revision|changed_since|conflict/.test(reason))return 'State changed on another screen or device. Current state has been reloaded; review it before trying again.';
 if(/outcome_unknown|timeout/.test(reason))return 'The operation response was not confirmed. Refresh and verify the actual state before retrying.';
 if(/owner|binding|unavailable/.test(reason))return 'Cannot verify the local Agent for this Owner. Check the Agent and the matching internal test build, then refresh.';
 if(/module_disabled/.test(reason))return 'This module is disabled. Refresh its current state.';
 return reason.replaceAll('_',' ');
}
export function useNativeDevice(section:DeviceSection,accountId:string|null){
 const [result,setResult]=useState<DeviceReply>(closed('not_checked'));
 const [pending,setPending]=useState(false),[message,setMessage]=useState<string|null>(null),[reload,setReload]=useState(0);
 const binding=useRef<string|null>(null),poller=useRef<ScopedReadPoller|null>(null),busy=useRef(false);
 const lastScope=useRef<string|null>(null);
 const epoch=useRef(0),scope=useRef<string|null>(accountId);scope.current=accountId;
 const current=result.state==='ready'&&result.accountId===accountId?result:null;
 useEffect(()=>{
  const generation=++epoch.current;
  const key=accountId?accountId+'|'+section:null;
  if(lastScope.current!==key){binding.current=null;setResult(closed('not_checked'));setMessage(null);}
  lastScope.current=key;busy.current=false;setPending(false);
  if(!accountId||!nativeDeviceAvailable())return;
  const read=async():Promise<DeviceReply>=>{
   if(section==='device.read')return nativeDeviceRequest(section,accountId,null);
   if(!binding.current){
    const found=await nativeDeviceRequest('device.read',accountId,null);
    if(found.state!=='ready')return found;
    if(epoch.current!==generation)return closed('cancelled');
    binding.current=found.deviceId;
   }
   return nativeDeviceRequest(section,accountId,binding.current);
  };
  const task=startScopedReadPoller({intervalMs:15000,task:read,healthy:x=>x.state==='ready',unavailable:()=>closed(),
   apply:value=>{if(epoch.current===generation){if(value.state!=='ready')binding.current=null;setResult(value);}}});
  poller.current=task;
  const refreshAll=()=>task.refreshNow();document.addEventListener('lightremote:refresh',refreshAll);
  return()=>{epoch.current++;task.stop();document.removeEventListener('lightremote:refresh',refreshAll);if(poller.current===task)poller.current=null;};
 },[section,accountId,reload]);
 const refresh=useCallback(()=>poller.current?.refreshNow(),[]);
 const run=useCallback(async(action:DeviceAction,payload:Record<string,unknown>={}):Promise<DeviceReply>=>{
  if(!accountId||scope.current!==accountId||!current||busy.current)return closed('desktop_owner_required');
  busy.current=true;setPending(true);setMessage(null);
  const generation=++epoch.current;poller.current?.stop();
  let answer:DeviceReply=closed();
  try{
   answer=await nativeDeviceRequest(action,accountId,current.deviceId,payload);
   if(epoch.current!==generation||scope.current!==accountId)return closed('cancelled');
   if(answer.state==='unavailable')setMessage(deviceErrorMessage(answer.reason));
   else setMessage(answer.view.operation.requested?'Requested. Waiting for the Agent to confirm the resulting state.':'Saved.');
   const fresh=await nativeDeviceRequest(section,accountId,current.deviceId);
   if(epoch.current===generation&&scope.current===accountId)setResult(fresh);
   if(answer.state==='ready'&&epoch.current===generation&&scope.current===accountId)
    document.dispatchEvent(new CustomEvent('lightremote:device-change',{detail:{accountId}}));
   return answer;
  }finally{
   if(epoch.current===generation&&scope.current===accountId){busy.current=false;setPending(false);setReload(x=>x+1);}
  }
 },[accountId,current,section]);
 return {reply:current,view:current?.view??null,pending,message,available:Boolean(current),refresh,run,
  reason:result.state==='unavailable'?result.reason:null};
}
