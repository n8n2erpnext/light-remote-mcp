import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Database,TerminalSquare,FolderOpen,ShieldCheck} from 'lucide-react';
import {Button} from './components/ui/button';
import {Card,CardHeading} from './components/ui/card';
import {useNativeDevice,deviceErrorMessage,type MemoryScope,type CodexTask} from './lib/native-device';
import {StatusBadge,EmptyState,DetailNote,RecordDetails,DateLabel,stateLabel} from './components/ProductUi';
import {nativeLinkAvailable,nativeShellAction} from './DeviceLinkDialog';

const bytes=(x:number|null)=>x===null?'—':(x/1048576).toFixed(2)+' MiB';
function Metric({label,value,children}:{label:string;value:string;children:ReactNode}){
 return <Card className="feature-kpi"><span className="eyebrow">{label}</span><strong className="feature-kpi-value">{value}</strong><span className="muted">{children}</span></Card>;
}
export function useDeviceConfirmation(ownerKey:string|null){
 const [request,setRequest]=useState<{text:string;exact:string|null;resolve:(value:boolean)=>void}|null>(null);
 const [input,setInput]=useState('');const active=useRef<((value:boolean)=>void)|null>(null);
 const panel=useRef<HTMLElement|null>(null);
 useEffect(()=>{setRequest(null);return()=>{active.current?.(false);active.current=null;};},[ownerKey]);
 useEffect(()=>{
  if(!request)return;
  const prior=document.activeElement as HTMLElement|null;
  panel.current?.querySelector<HTMLElement>('input,button')?.focus();
  return()=>{if(prior?.isConnected)prior.focus();};
 },[request]);
 const ask=(text:string,exact:string|null=null)=>{
  if(active.current)return Promise.resolve(false);
  setInput('');return new Promise<boolean>(resolve=>{active.current=resolve;setRequest({text,exact,resolve});});
 };
 const finish=(answer:boolean)=>{const resolve=active.current;active.current=null;setRequest(null);resolve?.(answer);};
 const dialog=request?<div className="native-confirm-overlay" onKeyDown={e=>{
  if(e.key==='Escape')finish(false);
  if(e.key==='Tab'){
   const nodes=panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
   const first=nodes?.[0],last=nodes?.[nodes.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
   if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 }}>
  <section ref={panel} className="native-confirm" role="dialog" aria-modal="true" aria-label="Confirm device action">
   <span className="dialog-symbol"><ShieldCheck size={24} aria-hidden="true"/></span><h2>Confirm action</h2><p>{request.text}</p>
   {request.exact!==null&&<label>Type <strong>{request.exact}</strong> to confirm
    <input autoFocus value={input} onChange={e=>setInput(e.target.value)} autoComplete="off" aria-label="Exact confirmation text" /></label>}
   <div className="feature-actions"><Button onClick={()=>finish(false)}>Cancel</Button>
    <Button variant="primary" disabled={request.exact!==null&&input!==request.exact} onClick={()=>finish(true)}>Confirm</Button></div>
  </section></div>:null;
 return {ask,dialog};
}
function StateMessage({message,reason}:{message:string|null;reason:string|null}){
 return message?<p role="status" className="native-action-message">{message}</p>:
  reason?<div className="native-state-note"><p role="status" className="muted">{deviceErrorMessage(reason)}</p><RecordDetails label="Connection details" rows={[["Reason",reason]]}/></div>:null;
}
export function LongMemoryScreen({accountId}:{accountId:string|null}){
 const api=useNativeDevice('memory.read',accountId),{ask,dialog}=useDeviceConfirmation(accountId);
 const flags=api.view?.modules,memory=api.view?.memory,enabled=flags?.longMemory===true;
 const [name,setName]=useState(''),[capture,setCapture]=useState('manual');
 useEffect(()=>{setName('');setCapture('manual');},[accountId]);
 const sync=memory?.sync,policy=sync?.state==='ready'?sync.policy:null;
 const homes=[...new Set(memory?.scopes.filter(s=>!s.tombstoned).map(s=>s.homeDeviceId)||[])];
 const homeName=(id:string)=>id===api.reply?.deviceId?'This device':sync?.devices?.find(d=>d.deviceId===id)?.name||id;
 const create=async(event:FormEvent)=>{
  event.preventDefault();if(!name.trim()||api.pending)return;
  const answer=await api.run('memory.create',{displayName:name.trim(),captureMode:capture});
  if(answer.state==='ready')setName('');
 };
 const lifecycle=async(scope:MemoryScope,kind:'archive'|'restore'|'delete-local'|'delete-account')=>{
  const text=kind==='delete-account'?`Schedule deletion of “${scope.displayName}” across this account? Offline devices still require delivery and acknowledgment.`:
   kind==='delete-local'?`Delete this device's records for “${scope.displayName}”? Other devices and existing backups are retained.`:
    `${kind==='archive'?'Archive':'Restore'} “${scope.displayName}” on this device?`;
  const destructive=kind.startsWith('delete');
  if(!await ask(text,destructive?scope.displayName:null))return;
  const actions={archive:'memory.archive',restore:'memory.restore','delete-local':'memory.delete-local','delete-account':'memory.delete-account'} as const;
  await api.run(actions[kind],{scopeId:scope.scopeId,confirmed:true,...(destructive?{confirmName:scope.displayName}:{})});
 };
 const setSync=async(enabledValue:boolean,deviceId?:string,selected?:boolean,mode?:string)=>{
  if(!policy)return;
  const devices=policy.devices.map(d=>({deviceId:d.deviceId,selected:d.deviceId===deviceId?(selected??d.selected):d.selected,
   mode:d.deviceId===deviceId?(mode??d.mode):d.mode}));
  await api.run('memory.sync-policy',{enabled:enabledValue,expectedRevision:policy.revision,devices});
 };
 return <div className="screen-content feature-dashboard native-module-screen">
  <Card className="module-intro"><div className="module-intro-copy"><span className="module-symbol"><Database size={25} aria-hidden="true"/></span><div><h2>Keep your project context</h2><p>Save work on this PC and pick up where you left off.</p></div></div><div className="feature-actions"><StatusBadge value={flags?(enabled?'enabled':'disabled'):'unknown'}/><Button disabled={!flags||api.pending} variant={enabled?'secondary':'primary'} onClick={()=>flags&&void api.run('module.configure',{module:'longMemory',enabled:!enabled,expectedRevision:flags.revision})}>{api.pending?'Saving…':enabled?'Disable Long Memory':'Enable Long Memory'}</Button></div><p className="module-footnote">{enabled?'Your saved work is available on this PC.':'Turning Long Memory off keeps your saved work for later.'}</p><StateMessage message={api.message} reason={api.reason}/></Card>
  <div className="feature-kpi-grid"><Metric label="Saved projects" value={memory?String(memory.scopes.filter(x=>!x.tombstoned).length):'—'}>Projects on this PC</Metric><Metric label="Local storage" value={bytes(memory?.localFileBytes??null)}>Space used on this PC</Metric><Metric label="Last sync" value={memory?.lastConfirmedSyncAt?new Date(memory.lastConfirmedSyncAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):'—'}>Last confirmed transfer</Metric></div>
  <Card><CardHeading description="Give each project its own saved context.">Your memory library</CardHeading>
   {memory?.coverage&&memory.coverage.total>memory.coverage.returned&&<p className="muted" role="status">Showing {memory.coverage.returned} of {memory.coverage.total} projects. Open Wall to view the rest.</p>}
   <form className="native-create-form product-create-form" onSubmit={event=>void create(event)}><label className="grow-field"><span>Project name</span><input aria-label="New project name" placeholder="e.g. Website redesign" maxLength={240} value={name} onChange={e=>setName(e.target.value)} disabled={!enabled||api.pending}/></label><label><span>Save mode</span><select aria-label="New project save mode" value={capture} onChange={e=>setCapture(e.target.value)} disabled={!enabled||api.pending}><option value="manual">Manual</option><option value="auto">Automatic</option></select></label><Button type="submit" variant="primary" disabled={!enabled||!name.trim()||api.pending}>Create project</Button></form>
   <div role="region" aria-label="Long Memory scopes" className="memory-projects">{memory?.scopes.length?memory.scopes.map(scope=><article className="memory-project" key={scope.scopeId}><div className="project-card-heading"><span className="project-icon"><FolderOpen size={22} aria-hidden="true"/></span><div><h3>{scope.displayName}</h3><span className="cell-meta">{scope.checkpoints??'—'} saved checkpoints</span></div><StatusBadge value={scope.tombstoned?'closed':scope.status} label={scope.tombstoned?'Deleted locally':undefined}/></div><div className="project-meta"><span>Stored on <strong>{homeName(scope.homeDeviceId)}</strong></span><span>{bytes(scope.bytes)}</span><span>Last sync <DateLabel value={scope.lastConfirmedSyncAt} empty="Not synced yet"/></span></div><details className="project-manage"><summary>Manage project</summary><div className="project-controls">{!scope.tombstoned&&<><Button disabled={api.pending} onClick={()=>void lifecycle(scope,scope.status==='archived'?'restore':'archive')}>{scope.status==='archived'?'Restore':'Archive'}</Button>{scope.status==='active'&&scope.homeDeviceId===api.reply?.deviceId&&<Button disabled={api.pending} onClick={()=>void api.run('memory.capture',{scopeId:scope.scopeId,captureMode:scope.captureMode==='auto'?'manual':'auto'})}>{scope.captureMode==='auto'?'Save manually':'Save automatically'}</Button>}<Button className="danger-action" disabled={api.pending} onClick={()=>void lifecycle(scope,'delete-local')}>Delete from this PC</Button>{scope.homeDeviceId===api.reply?.deviceId&&<Button className="danger-action" disabled={api.pending} onClick={()=>void lifecycle(scope,'delete-account')}>Delete from all devices</Button>}</>}<RecordDetails label="Project details" rows={[["Scope ID",scope.scopeId],["Home device ID",scope.homeDeviceId],["Revision",scope.revision],["Capture mode",scope.captureMode],["Last confirmed sync",<DateLabel value={scope.lastConfirmedSyncAt}/>]]}/></div></details></article>):<EmptyState title={!flags?'Connect this PC to load saved work':enabled?'Your next project starts here':'Long Memory is off'}>{enabled?'Create a project above to start keeping its context.':'Enable Long Memory to create projects or view your saved work.'}</EmptyState>}</div>
  </Card>
  <Card><div className="feature-section-title"><CardHeading description="Choose which of your devices receive a copy of your saved work.">Sync across devices</CardHeading>{policy&&<Button disabled={api.pending} onClick={()=>void setSync(!policy.enabled)}>{policy.enabled?'Disable sync':'Enable sync'}</Button>}</div>
   {policy?<><div className="sync-summary"><StatusBadge value={policy.enabled?'enabled':'disabled'} label={policy.enabled?'Sync is on':'Sync is off'}/><span className="muted">Last synced <DateLabel value={memory?.lastConfirmedSyncAt} empty="Not synced yet"/></span></div>{sync?.devices?.length?<div className="native-device-options">{sync.devices.map(device=>{const row=policy.devices.find(d=>d.deviceId===device.deviceId);return <div className="native-sync-device" key={device.deviceId}><label><input type="checkbox" aria-label={'Sync '+(device.name||'device')} checked={row?.selected===true} disabled={!row||api.pending} onChange={e=>void setSync(policy.enabled,device.deviceId,e.target.checked)}/><span><strong>{device.name||'Unnamed device'}</strong><small className="cell-meta">{device.deviceId===api.reply?.deviceId?'This PC':'Linked device'}</small></span></label><StatusBadge value={device.state}/><select aria-label={'Sync mode '+(device.name||'device')} value={row?.mode||'auto'} disabled={!row||api.pending} onChange={e=>void setSync(policy.enabled,device.deviceId,undefined,e.target.value)}><option value="auto">Automatic</option><option value="follow_project">Follow project</option><option value="manual">Only when I ask</option></select>{row?.mode==='manual'&&<Button disabled={!policy.enabled||!row.selected||api.pending} onClick={()=>void api.run('memory.sync-manual',{deviceId:device.deviceId})}>Sync now</Button>}</div>;})}</div>:<p className="muted">No other devices are available for sync.</p>}<DetailNote title="How sync works"><p>Automatic sync sends approved project updates. Follow project syncs work with a verified project connection. Only when I ask waits for Sync now. Changes save immediately.</p><p>Policy revision: {policy.revision}. Each project has its own Home device. Sync must be confirmed by the receiving device.</p></DetailNote></>:<EmptyState title={enabled?'Sync is unavailable':'Enable Long Memory to use sync'}>{enabled?'Local saved work remains available. Connect to your account to load sync settings.':'Your saved work stays on this PC until you enable sync.'}</EmptyState>}
  </Card><DetailNote title="Storage details"><p>Local file: {bytes(memory?.localFileBytes??null)} · live data: {bytes(memory?.liveBytes??null)} · checkpoints: {bytes(memory?.checkpointBytes??null)}. Module revision: {flags?.revision??'Not available'}. {homes.length} Home devices.</p></DetailNote>
  {!flags&&<div className="feature-unavailable"><strong>Connect this PC to manage memory</strong><p>Sign in with the account linked to this device and refresh.</p></div>}{dialog}
 </div>;
}

export function CodexBridgeScreen({accountId}:{accountId:string|null}){
 const api=useNativeDevice('codex.read',accountId),{ask,dialog}=useDeviceConfirmation(accountId);
 const flags=api.view?.modules,enabled=flags?.codexBridge===true,codex=api.view?.codex;
 const [title,setTitle]=useState(''),[editing,setEditing]=useState<CodexTask|null>(null),[editTitle,setEditTitle]=useState('');
 const [login,setLogin]=useState<string|null>(null),[account,setAccount]=useState<string|null>(null);
 useEffect(()=>{setLogin(null);setAccount(null);setEditing(null);setTitle('');},[accountId]);
 const create=async(event:FormEvent)=>{event.preventDefault();if(!title.trim())return;
  const r=await api.run('codex.task-create',{title:title.trim()});if(r.state==='ready')setTitle('');};
 const saveEdit=async(event:FormEvent)=>{event.preventDefault();if(!editing||!editTitle.trim())return;
  const r=await api.run('codex.task-edit',{id:editing.id,title:editTitle.trim(),expectedChangedAt:editing.changedAt});
  if(r.state==='ready')setEditing(null);};
 const remove=async(task:CodexTask)=>{
  if(await ask(`Delete “${task.title}” from future observers? Existing history and receipts are retained.`,task.title))
   await api.run('codex.task-delete',{id:task.id,expectedChangedAt:task.changedAt,confirmed:true,confirmTitle:task.title});
 };
 const signIn=async()=>{
  if(!await ask('Sign this device in to Codex using your ChatGPT plan? The verification page opens in your browser.'))return;
  const r=await api.run('codex.login',{confirmed:true});if(r.state==='ready')setLogin(r.view.operation.userCode);
 };
 return <div className="screen-content feature-dashboard native-module-screen">
  <Card className="module-intro"><div className="module-intro-copy"><span className="module-symbol"><TerminalSquare size={25} aria-hidden="true"/></span><div><h2>Your Codex workspace</h2><p>Prepare tasks, then choose when Codex works on them.</p></div></div><div className="feature-actions"><StatusBadge value={flags?(enabled?'enabled':'disabled'):'unknown'}/><Button disabled={!flags||api.pending} variant={enabled?'secondary':'primary'} onClick={()=>flags&&void api.run('module.configure',{module:'codexBridge',enabled:!enabled,expectedRevision:flags.revision})}>{enabled?'Disable Codex Bridge':'Enable Codex Bridge'}</Button></div><p className="module-footnote">Opening this page does not start Codex or run a task.</p><StateMessage message={api.message} reason={api.reason}/></Card>
  <Card><CardHeading description="Set up Codex on this PC before starting work.">Get ready to work</CardHeading><div className="codex-setup"><div><span className="setup-number">1</span><h3>Install Codex</h3><p>{codex?.runtime.installing?'Installation in progress…':codex?.runtime.installed?'Codex is installed on this PC.':codex?.runtime.externalAvailable?'An existing Codex installation is available.':'Install the optional Codex tools on this PC.'}</p><Button disabled={!enabled||api.pending||codex?.runtime.installing||codex?.runtime.installed} onClick={()=>void ask('Install the official optional Codex runtime on this device?').then(async yes=>{if(yes)await api.run('codex.runtime-install',{confirmed:true});})}>{codex?.runtime.installed?'Installed':'Install Codex'}</Button></div><div><span className="setup-number">2</span><h3>Sign in to Codex</h3><p>{account||'Use your ChatGPT account to connect Codex.'}</p><Button disabled={!enabled||api.pending} onClick={()=>void signIn()}>Sign in to Codex</Button><Button variant="ghost" disabled={!enabled||api.pending} onClick={()=>void api.run('codex.account').then(r=>{if(r.state==='ready')setAccount(r.view.operation.connected?(r.view.operation.plan||'Connected'):'Signed out');})}>Check account</Button></div><div><span className="setup-number">3</span><h3>Choose a task</h3><p>Add work below. Start with Codex when you’re ready to let it run.</p><StatusBadge value={codex?.operation?.state||'unknown'} label={codex?.operation?.state==='running'?'Codex is working':'Waiting for your next step'}/></div></div>
   {codex?.runtime.lastError&&<p role="alert">{deviceErrorMessage(codex.runtime.lastError)}</p>}{codex?.operation?.error&&<p role="alert">{deviceErrorMessage(codex.operation.error)}</p>}
   {login&&<div className="codex-login-note" role="status"><strong>Your sign-in code: <code>{login}</code></strong><p>Finish signing in in your browser, then select Check account.</p><Button disabled={api.pending} onClick={()=>void api.run('codex.login-cancel',{confirmed:true}).then(r=>{if(r.state==='ready')setLogin(null);})}>Cancel Codex sign-in</Button></div>}
  </Card>
  <Card><div className="feature-section-title"><CardHeading description="Editing a task does not start it. You decide when to hand work to Codex.">Your tasks</CardHeading><Button disabled={!enabled||api.pending||codex?.operation?.state==='running'} onClick={()=>void ask('Ask Codex to review tasks on this PC? It can suggest changes but cannot approve them for you.').then(async yes=>{if(yes)await api.run('codex.observe',{confirmed:true});})}>Review tasks with Codex</Button></div>
   {codex?.coverage&&codex.coverage.total>codex.coverage.returned&&<p className="muted" role="status">Showing {codex.coverage.returned} of {codex.coverage.total} tasks. Open Wall to view the rest.</p>}
   <form className="native-create-form product-create-form" onSubmit={event=>void create(event)}><label className="grow-field"><span>What would you like to work on?</span><input aria-label="New Codex task title" value={title} maxLength={240} placeholder="e.g. Review the checkout flow" disabled={!enabled||api.pending} onChange={e=>setTitle(e.target.value)}/></label><Button variant="primary" type="submit" disabled={!enabled||!title.trim()||api.pending}>Add task</Button></form>
   {editing&&<form className="native-create-form product-create-form" onSubmit={event=>void saveEdit(event)}><label className="grow-field"><span>Edit task</span><input aria-label="Edit Codex task title" value={editTitle} maxLength={240} onChange={e=>setEditTitle(e.target.value)}/></label><Button type="submit" disabled={!editTitle.trim()||api.pending}>Save edit</Button><Button onClick={()=>setEditing(null)}>Cancel edit</Button></form>}
   <div className="feature-table feature-table-scroll" role="region" aria-label="Codex tasks"><table><thead><tr><th>Task</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{codex?.tasks.length?codex.tasks.map(task=>{const delegation=codex.delegations.find(d=>d.taskId===task.id);return <tr key={task.id}><td><strong className="cell-title">{task.title}</strong><span className="cell-meta">Updated <DateLabel value={task.changedAt}/></span>{delegation&&<span className="cell-meta">{stateLabel(delegation.state)} · {delegation.rounds??0} of {delegation.maxRounds??'—'} work rounds</span>}</td><td><select aria-label={'Task state '+task.title} value={task.state} disabled={api.pending} onChange={e=>void api.run('codex.task-state',{id:task.id,state:e.target.value,expectedChangedAt:task.changedAt})}>{['todo','working','waiting','done'].map(v=><option key={v} value={v}>{stateLabel(v)}</option>)}</select></td><td><div className="row-actions"><Button variant="primary" disabled={api.pending||!['todo','working'].includes(task.state)} onClick={()=>void ask(`Allow Codex up to two work rounds for “${task.title}” in its device-owned workspace?`).then(async yes=>{if(yes)await api.run('codex.delegate',{taskId:task.id,goal:task.title,maxRounds:2,confirmed:true});})}>Start with Codex</Button>{delegation&&<Button disabled={api.pending} onClick={()=>void ask(`Pause Codex work on “${task.title}”?`).then(async yes=>{if(yes)await api.run('codex.pause',{taskId:task.id,confirmed:true});})}>Pause</Button>}<details className="task-more"><summary>More</summary><div className="feature-actions"><Button disabled={api.pending} onClick={()=>{setEditing(task);setEditTitle(task.title);}}>Edit</Button><Button className="danger-action" disabled={api.pending} onClick={()=>void remove(task)}>Delete</Button><RecordDetails label="Task details" rows={[["Task ID",task.id],["Created",<DateLabel value={task.createdAt}/>],["Changed at",task.changedAt],["Delegation state",delegation?.state],["Decision",delegation?.decision]]}/></div></details></div></td></tr>;}):<tr><td colSpan={3}><EmptyState title={!flags?'Connect this PC to load tasks':enabled?'What’s next?':'Codex Bridge is off'}>{enabled?'Add a task above. Codex will wait for you to start it.':'Enable Codex Bridge to set up Codex and manage tasks.'}</EmptyState></td></tr>}</tbody></table></div>
  </Card><DetailNote title="Codex maintenance"><p>Managed installation: {codex?.runtime.state||'Not available'}. Observer: {codex?.operation?.state||'Idle'}. Controller recommendation: {codex?.recommendation||'Not available'}.</p><div className="feature-actions"><Button disabled={!enabled||!codex?.runtime.installed||api.pending||codex.runtime.installing} onClick={()=>void ask('Remove the managed Codex runtime? Saved tasks and memory remain on this device.').then(async yes=>{if(yes)await api.run('codex.runtime-remove',{confirmed:true});})}>Remove Codex installation</Button><Button disabled={!enabled||api.pending} onClick={()=>void ask('Sign this device out of Codex?').then(async yes=>{if(yes)await api.run('codex.logout',{confirmed:true});})}>Sign out of Codex</Button></div></DetailNote>
  {!flags&&<div className="feature-unavailable"><strong>Connect this PC to manage Codex</strong><p>Sign in with the account linked to this device and refresh.</p></div>}{dialog}
 </div>;
}

export function NativeDeviceSettings({accountId}:{accountId:string|null}){
 const api=useNativeDevice('settings.read',accountId),{ask,dialog}=useDeviceConfirmation(accountId);
 const [shell,setShell]=useState<{online:boolean}|null>(null),[shellBusy,setShellBusy]=useState(false),[shellMessage,setShellMessage]=useState<string|null>(null);
 const sequence=useRef(0),reading=useRef(false),acting=useRef(false);
 const owner=useRef(accountId);owner.current=accountId;
 const mounted=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const windows=nativeLinkAvailable();
 useEffect(()=>{
  if(!windows)return;
  let active=true;
  const read=async()=>{
   if(reading.current||acting.current||document.hidden)return;
   reading.current=true;const revision=++sequence.current;
   try{
    const value=await nativeShellAction('status');
    if(active&&revision===sequence.current)setShell(typeof value.wallOnline==='boolean'?{online:value.wallOnline}:null);
   }finally{reading.current=false;}
  };
  void read();const timer=window.setInterval(()=>void read(),15000);
  return()=>{active=false;sequence.current++;window.clearInterval(timer);};
 },[windows,accountId]);
 const hostAction=async(action:'service-start'|'service-stop'|'restart'|'update')=>{
  const text=action==='service-stop'?'Stop the background Agent? Its sessions and work may be interrupted.':action==='service-start'?'Start the background Agent on this device?':
   action==='restart'?'Restart the background Agent on this device?':'Ask the installed updater to check the configured internal update policy?';
  if(acting.current||!await ask(text))return;
  if(!mounted.current||owner.current!==accountId)return;
  acting.current=true;const revision=++sequence.current;setShellBusy(true);setShellMessage(null);
  try{
   const result=await nativeShellAction(action);
   if(!mounted.current||owner.current!==accountId||revision!==sequence.current)return;
   setShellMessage(result.ok===true?action==='service-start'?'Agent is running.':action==='service-stop'?'Agent stopped.':action==='restart'?'Agent restart requested.':'Update check requested.':'The host action was not confirmed. Refresh its actual state.');
   const current=await nativeShellAction('status');
   if(!mounted.current||owner.current!==accountId||revision!==sequence.current)return;
   setShell(typeof current.wallOnline==='boolean'?{online:current.wallOnline}:null);
   api.refresh();
  }finally{acting.current=false;if(mounted.current)setShellBusy(false);}
 };
 const device=api.view?.device,log=api.view?.activityLog;
 return <>
  <Card id="settings-agent"><CardHeading description="Keep this PC available for your approved AI agents.">Connection &amp; updates</CardHeading><div className="feature-pairs"><div><span>Background Agent</span><StatusBadge value={shell?shell.online?'running':'closed':device?'ready':'unknown'} label={shell?shell.online?'Running':'Stopped':device?'Available':'Unavailable'}/></div><div><span>Account connection</span><StatusBadge value={device?.cloudState}/></div><div><span>Agent version</span><strong>{device?.version||'Not available'}</strong></div></div>
   <div className="feature-actions">{windows&&<><Button variant="primary" disabled={!shell||shellBusy} onClick={()=>void hostAction(shell?.online?'service-stop':'service-start')}>{shell?.online?'Stop Agent':'Start Agent'}</Button><Button disabled={shellBusy} onClick={()=>void hostAction('update')}>Check for updates</Button></>}<Button disabled={!device||api.pending} onClick={()=>void ask(device?.cloudDesiredConnected?'Disconnect this PC from your account? Active AI access may be interrupted.':'Connect this PC to your account?').then(async yes=>{if(yes)await api.run(device?.cloudDesiredConnected?'device.disconnect':'device.connect',{confirmed:true});})}>{device?.cloudDesiredConnected?'Disconnect Cloud':'Connect Cloud'}</Button><Button variant="ghost" disabled={api.pending} onClick={api.refresh}>Refresh connection</Button></div><p className="muted">The Agent keeps running when you close Desktop. Stopping it may interrupt work.</p>{shellMessage&&<p role="status" className="native-action-message">{shellMessage}</p>}<StateMessage message={api.message} reason={api.reason}/>
   <DetailNote title="Advanced Agent maintenance">{windows&&<Button disabled={shellBusy} onClick={()=>void hostAction('restart')}>Restart Agent</Button>}<p>Restarting can interrupt active sessions. Use this only when the Agent is not responding.</p></DetailNote>
  </Card>
  <Card id="settings-permissions"><CardHeading description="What this PC allows approved AI agents to do.">Permissions</CardHeading>{device?<><div className="permission-summary"><ShieldCheck size={23} aria-hidden="true"/><div><strong>{device.policy.effectiveCapabilities.length} permissions available</strong><p>{device.policy.deniedCapabilities.length?`${device.policy.deniedCapabilities.length} permissions are blocked by this PC.`:'No additional local blocks are reported.'}</p></div></div><p className="muted">These permissions apply after you approve an agent. Change device policy in Wall; operating system privacy settings apply separately.</p><DetailNote title="View effective permission details"><p>Profile: {device.policy.profile||'Not available'} · revision {device.policy.revision??'Not available'}</p><h3>Allowed</h3><ul className="permission-list">{device.policy.effectiveCapabilities.map(x=><li key={x}><code>{x}</code></li>)}</ul>{!device.policy.effectiveCapabilities.length&&<p>None reported</p>}<h3>Blocked on this PC</h3><ul className="permission-list">{device.policy.deniedCapabilities.map(x=><li key={x}><code>{x}</code></li>)}</ul>{!device.policy.deniedCapabilities.length&&<p>None reported</p>}</DetailNote></>:<EmptyState title="Permissions are unavailable">Connect this PC to see its current device policy.</EmptyState>}</Card>
  <Card id="settings-logs" className="activity-logs-card"><CardHeading description="Working activity is stored on this PC and rotated automatically.">Activity history</CardHeading>{log?<><div className="feature-pairs"><div><span>Space used</span><strong>{bytes(log.usedBytes)} of {bytes(log.maxDiskBytes)}</strong></div></div><progress aria-label="Activity history storage" max={log.maxDiskBytes} value={Math.min(log.usedBytes,log.maxDiskBytes)}/><div className="feature-form-row"><label htmlFor="native-log-preset">How much history to keep</label><select id="native-log-preset" value={log.preset} disabled={api.pending} onChange={e=>void api.run('logs.configure',{preset:e.target.value})}><option value="compact">Compact · 48 MiB</option><option value="standard">Standard · 200 MiB</option><option value="extended">Extended · 300 MiB</option></select></div><p className="muted">Changes save automatically. Older history is removed when the limit is reached.</p></>:<EmptyState title="History settings are unavailable">Connect this PC to view its activity storage.</EmptyState>}<Button className="danger-action" disabled={!log||api.pending} onClick={()=>void ask('Clear the working activity history saved on this PC?','CLEAN ACTIVITY LOGS').then(async yes=>{if(yes)await api.run('logs.clean',{confirmed:true,confirmText:'CLEAN ACTIVITY LOGS'});})}>Clear local history</Button><DetailNote title="History details"><p>Recent in-memory events: {log?.ramEvents??'Not available'}. Local working history is separate from account activity and saved project memory.</p></DetailNote></Card>{dialog}
 </>;
}
