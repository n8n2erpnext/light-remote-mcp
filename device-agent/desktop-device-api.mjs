// One local Owner API, reusing the same persisted modules and signed device
// channel controllers as Wall. Enabling modules never grants remote execution.
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const text=(x,n=240)=>typeof x==='string'?x.slice(0,n):null;
const number=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9._:-]{1,160}$/.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
function exact(input,keys,optional=[]){
 if(!object(input)||!keys.every(k=>Object.hasOwn(input,k))||
   Object.keys(input).some(k=>!keys.includes(k)&&!optional.includes(k)))throw fail('desktop_payload_invalid');
}
function confirm(input){if(input.confirmed!==true)throw fail('desktop_owner_confirmation_required',403);}
const flagsView=f=>({longMemory:f.longMemory===true,codexBridge:f.codexBridge===true,revision:number(f.revision)});
export function createDesktopDeviceApi({modules,localStatus,getSyncDevices,getSyncPolicy,
 getAccountDelete,closeSession,cancelJob,getLogStatus,logControl,connect,disconnect}={}){
 if(!modules||typeof localStatus!=='function')throw fail('desktop_dependencies_missing',503);
 let syncInFlight=null,operation=null;
 const syncView=()=>{
  if(!getSyncDevices||!getSyncPolicy)return Promise.resolve({state:'unavailable'});
  if(!syncInFlight)syncInFlight=Promise.all([getSyncDevices(),getSyncPolicy({action:'get'})])
   .then(([roster,answer])=>{
    if(!Array.isArray(roster?.devices)||!object(answer?.policy))throw fail('desktop_sync_unavailable',503);
    const policy=answer.policy;
    return {state:'ready',currentDeviceId:roster.currentDeviceId,
     devices:roster.devices.slice(0,100).map(d=>({deviceId:d.deviceId,name:text(d.displayName||d.deviceName||d.name,120),state:text(d.state,40),online:d.online===true})),
     policy:{enabled:policy.enabled===true,revision:number(policy.revision),devices:(policy.devices||[]).slice(0,100).map(d=>({deviceId:d.deviceId,selected:d.selected===true,mode:d.mode,manualRequestSeq:number(d.manualRequestSeq)}))}};
   }).catch(()=>({state:'unavailable'})).finally(()=>{syncInFlight=null;});
  // One outstanding cloud read shared across polls; an offline cloud must not
  // hide local module state or accumulate timed-out background work.
  return new Promise(resolve=>{
   const timer=setTimeout(()=>resolve({state:'unavailable'}),4500);
   syncInFlight.then(value=>{clearTimeout(timer);resolve(value);});
  });
 };
 function device(){
  const s=localStatus();
  return {deviceName:text(s.deviceName,120),cloudDesiredConnected:s.cloudDesiredConnected===true,
   cloudState:text(s.cloudState,40),version:text(s.version,40),platform:text(s.platformAdapter,40),
   executorReady:typeof s.executorReady==='boolean'?s.executorReady:null,
   policy:{profile:text(s.localPolicyProfile,40),revision:number(s.policyRevision),
    effectiveCapabilities:(s.effectiveCapabilities||[]).filter(x=>typeof x==='string').slice(0,100),
    deniedCapabilities:(s.deniedCapabilities||[]).filter(x=>typeof x==='string').slice(0,100)}};
 }
 async function read(action){
  const modulesView=flagsView(modules.flags());
  const base={asOf:Date.now(),modules:modulesView};
  if(action==='device.read')return {...base,device:device()};
  if(action==='memory.read'){
   if(!modulesView.longMemory)return {...base,memory:null};
   const usage=modules.localMemoryUsage(),active=modules.listMemoryScopes();
   const byId=new Map(active.map(s=>[s.scopeId,s]));
   return {...base,memory:{localFileBytes:number(usage.localFileBytes),liveBytes:number(usage.localDatabaseLiveBytes),
    checkpointBytes:number(usage.checkpointBodyBytes),lastConfirmedSyncAt:number(usage.lastConfirmedSyncAt),
    coverage:{returned:Math.min(100,(usage.scopes||[]).length),total:(usage.scopes||[]).length},
    scopes:(usage.scopes||[]).slice(0,100).map(s=>({scopeId:s.scopeId,displayName:text(s.displayName),
     homeDeviceId:s.homeDeviceId,status:s.status,tombstoned:s.tombstoned===true,captureMode:s.captureMode,
     revision:number(byId.get(s.scopeId)?.revision),checkpoints:number(s.checkpoints),bytes:number(s.checkpointBodyBytes),
     lastConfirmedSyncAt:number(s.lastConfirmedSyncAt)})),sync:await syncView()}};
  }
  if(action==='codex.read'){
   if(!modulesView.codexBridge)return {...base,codex:null};
   const observer=modules.observer(),runtime=modules.managedCodexStatus();
   return {...base,codex:{coverage:{returned:Math.min(100,observer.tasks.length),total:observer.tasks.length},tasks:observer.tasks.slice(0,100).map(t=>({id:t.id,title:text(t.title),state:t.state,
    createdAt:number(t.createdAt),changedAt:number(t.changedAt)})),recommendation:observer.recommendation,
    runtime:{state:runtime.state,installed:runtime.installed===true,externalAvailable:runtime.externalAvailable===true,
     installing:runtime.installing===true,lastError:text(runtime.lastError,160)},
    operation,delegations:modules.supervisorList().slice(0,100).map(d=>({taskId:d.taskId,state:d.state,decision:d.decision,
     maxRounds:d.maxRounds,rounds:d.rounds,updatedAt:d.updatedAt}))}};
  }
  if(action==='settings.read'){
   const log=typeof getLogStatus==='function'?await getLogStatus():null;
   return {...base,device:device(),activityLog:log?{preset:text(log.preset,30),usedBytes:number(log.usedBytes),
    maxDiskBytes:number(log.maxDiskBytes),ramEvents:number(log.ramEvents)}:null};
  }
  throw fail('desktop_action_denied',403);
 }
 return {async dispatch(action,payload,guard=()=>{}){
  guard();
  if(['device.read','memory.read','codex.read','settings.read'].includes(action)){
   exact(payload,[]);return read(action);
  }
  if(action==='module.configure'){
   exact(payload,['module','enabled','expectedRevision']);
   if(!['longMemory','codexBridge'].includes(payload.module)||typeof payload.enabled!=='boolean'||number(payload.expectedRevision)===null)
    throw fail('desktop_payload_invalid');
   const flags=modules.flags();
   if(flags.revision!==payload.expectedRevision)throw fail('gold_modules_revision_conflict',409);
   guard();
   return {modules:flagsView(modules.configure({...flags,[payload.module]:payload.enabled,expectedRevision:payload.expectedRevision}))};
  }
  if(action==='memory.create'){
   exact(payload,['displayName','captureMode']);
   if(typeof payload.displayName!=='string'||!payload.displayName.trim()||payload.displayName.length>240||
      !['manual','auto'].includes(payload.captureMode))throw fail('desktop_payload_invalid');
   return {scope:modules.createMemoryScope(payload)};
  }
  if(['memory.archive','memory.restore','memory.delete-local'].includes(action)){
   exact(payload,['scopeId','confirmed'],action==='memory.delete-local'?['confirmName']:[]);confirm(payload);
   if(!uuid(payload.scopeId))throw fail('desktop_payload_invalid');
   if(action==='memory.delete-local'&&typeof payload.confirmName!=='string')throw fail('desktop_payload_invalid');
   const method=action==='memory.archive'?'archiveMemoryScope':action==='memory.restore'?'restoreMemoryScope':'deleteMemoryScopeLocal';
   return {result:modules[method]({...payload,ownerConfirmed:true})};
  }
  if(action==='memory.capture'){
   exact(payload,['scopeId','captureMode']);
   if(!uuid(payload.scopeId)||!['manual','auto'].includes(payload.captureMode))throw fail('desktop_payload_invalid');
   return {result:modules.changeScopeCapture(payload)};
  }
  if(action==='memory.sync-policy'){
   exact(payload,['enabled','devices','expectedRevision']);
   if(!getSyncPolicy||!getSyncDevices)throw fail('desktop_sync_unavailable',503);
   if(typeof payload.enabled!=='boolean'||!Array.isArray(payload.devices)||payload.devices.length>100||number(payload.expectedRevision)===null)
    throw fail('desktop_payload_invalid');
   const directory=await getSyncDevices();guard();
   const owned=new Set(directory.devices.filter(d=>d.state!=='revoked').map(d=>d.deviceId));
   const seen=new Set();
   for(const d of payload.devices){
    exact(d,['deviceId','selected','mode']);
    if(!id(d.deviceId)||!owned.has(d.deviceId)||seen.has(d.deviceId)||typeof d.selected!=='boolean'||
      !['auto','follow_project','manual'].includes(d.mode))throw fail('memory_account_sync_device_invalid',403);
    seen.add(d.deviceId);
   }
   await getSyncPolicy({action:'set',policy:payload});return {saved:true};
  }
  if(action==='memory.sync-manual'){
   exact(payload,['deviceId']);if(!id(payload.deviceId)||!getSyncPolicy)throw fail('desktop_payload_invalid');
   await getSyncPolicy({action:'manual',deviceId:payload.deviceId});return {requested:true};
  }
  if(action==='memory.delete-account'){
   exact(payload,['scopeId','confirmName','confirmed']);confirm(payload);
   if(!uuid(payload.scopeId)||typeof payload.confirmName!=='string'||!getAccountDelete)throw fail('desktop_payload_invalid');
   const envelope=modules.signScopeDeleteAcrossAccount({...payload,ownerConfirmed:true});
   await getAccountDelete({action:'begin',envelope});guard();
   modules.applyScopeDeleteAcrossAccount(envelope);
   await getAccountDelete({action:'ack',scopeId:payload.scopeId});return {scheduled:true};
  }
  if(action==='codex.task-create'){
   exact(payload,['title'],['scopeId']);
   if(typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>240||
      (payload.scopeId!==undefined&&!uuid(payload.scopeId)))throw fail('desktop_payload_invalid');
   return {task:modules.addTask(payload)};
  }
  if(['codex.task-edit','codex.task-state','codex.task-delete'].includes(action)){
   const specific=action==='codex.task-edit'?['title']:action==='codex.task-state'?['state']:['confirmTitle','confirmed'];
   exact(payload,['id','expectedChangedAt',...specific]);
   if(!uuid(payload.id)||number(payload.expectedChangedAt)===null)throw fail('desktop_payload_invalid');
   const current=modules.observer().tasks.find(t=>t.id===payload.id);
   if(!current)throw fail('gold_observer_task_not_found',404);
   if(current.changedAt!==payload.expectedChangedAt)throw fail('gold_observer_task_changed_since_edit',409);
   if(action==='codex.task-edit')return {result:modules.editTask(payload)};
   if(action==='codex.task-delete'){
    confirm(payload);return {result:modules.deleteTask({...payload,confirm:true})};
   }
   if(!['todo','working','waiting','done'].includes(payload.state))throw fail('desktop_payload_invalid');
   return {result:modules.updateTask(payload)};
  }
  if(action==='codex.account'){
   exact(payload,[]);
   const r=await modules.codexPlusStatus();
   return {connected:r.connected===true,authMode:text(r.authMode,40),plan:text(r.plan,40)};
  }
  if(['codex.runtime-install','codex.runtime-remove','codex.login','codex.logout','codex.login-cancel','codex.observe'].includes(action)){
   exact(payload,['confirmed']);confirm(payload);
   if(action==='codex.runtime-install'){modules.installManagedCodexRuntime();return {requested:true};}
   if(action==='codex.runtime-remove'){modules.removeManagedCodexRuntime();return {removed:true};}
   if(action==='codex.login'){
    const r=await modules.codexPlusLogin();
    // The CLI's one-time user code is intended for the owner's login UI.
    // It is not a bearer, refresh token or the private app-server loginId.
    const url=new URL(r.verificationUrl);
    if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com','login.openai.com'].includes(url.hostname)||
      url.username||url.password||url.port||url.href.length>1000)throw fail('desktop_codex_login_url_invalid',503);
    return {state:text(r?.state,40)||'started',verificationUrl:url.href,userCode:text(r.userCode,48)};
   }
   if(action==='codex.login-cancel'){await modules.codexPlusCancel();return {cancelled:true};}
   if(action==='codex.logout'){await modules.codexPlusLogout();return {signedOut:true};}
   if(operation?.state==='running')throw fail('codex_run_already_in_progress',409);
   // Long observer work remains in the Agent. A bounded native request only
   // acknowledges its start; later polls report actual completion/failure.
   operation={state:'running',startedAt:Date.now(),finishedAt:null,error:null};
   void modules.codexPlusObserve().then(()=>{
    operation={...operation,state:'completed',finishedAt:Date.now()};
   }).catch(e=>{
    operation={...operation,state:'failed',finishedAt:Date.now(),error:/^[a-z0-9_]{1,100}$/.test(e.message||'')?e.message:'codex_observer_failed'};
   });
   return {requested:true};
  }
  if(action==='codex.delegate'){
   exact(payload,['taskId','goal','maxRounds','confirmed']);confirm(payload);
   if(!uuid(payload.taskId)||typeof payload.goal!=='string'||payload.goal.length>2000||
      !Number.isInteger(payload.maxRounds)||payload.maxRounds<1||payload.maxRounds>5)throw fail('desktop_payload_invalid');
   const d=modules.supervisorDelegate({...payload,ownerApproved:true});
   return {state:d.state,taskId:d.taskId}; // workspace always Agent-owned
  }
  if(action==='codex.pause'){
   exact(payload,['taskId','confirmed']);confirm(payload);
   if(!uuid(payload.taskId))throw fail('desktop_payload_invalid');
   modules.supervisorPause({...payload,ownerApproved:true});return {requested:true};
  }
  if(action==='sessions.close'){
   exact(payload,['sessionId','agentId','confirmed']);confirm(payload);
   if(!id(payload.sessionId)||!id(payload.agentId)||!closeSession)throw fail('desktop_payload_invalid');
   const result=await closeSession(payload);return {state:text(result?.state,40)||'close_requested'};
  }
  if(action==='jobs.cancel'){
   exact(payload,['jobId','confirmed']);confirm(payload);
   if(!uuid(payload.jobId)||!cancelJob)throw fail('desktop_payload_invalid');
   const result=await cancelJob(payload.jobId);return {state:text(result?.state,40)||'stop_requested'};
  }
  if(action==='device.connect'||action==='device.disconnect'){
   exact(payload,['confirmed']);confirm(payload);
   const operation=action==='device.connect'?connect:disconnect;
   if(!operation)throw fail('desktop_connection_unavailable',503);
   await operation();return {requested:true}; // display the subsequent actual Agent state
  }
  if(action==='logs.configure'){
   exact(payload,['preset']);
   if(!['compact','standard','extended'].includes(payload.preset)||!logControl)throw fail('desktop_payload_invalid');
   await logControl('configure',payload);return {saved:true};
  }
  if(action==='logs.clean'){
   exact(payload,['confirmed','confirmText']);confirm(payload);
   if(payload.confirmText!=='CLEAN ACTIVITY LOGS'||!logControl)throw fail('desktop_payload_invalid');
   await logControl('clean',payload);return {cleaned:true};
  }
  throw fail('desktop_action_denied',403);
 }};
}
