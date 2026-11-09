import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {Database,HardDrive,Server,TerminalSquare} from 'lucide-react';
import {Button} from './components/ui/button';
import {Card,CardHeading} from './components/ui/card';
import {useNativeDevice,deviceErrorMessage,type MemoryScope,type CodexTask} from './lib/native-device';
import {nativeLinkAvailable,nativeShellAction} from './DeviceLinkDialog';

const stamp=(x:number|null)=>x===null?'—':new Date(x).toLocaleString();
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
   <h2>Confirm action</h2><p>{request.text}</p>
   {request.exact!==null&&<label>Type <strong>{request.exact}</strong> to confirm
    <input autoFocus value={input} onChange={e=>setInput(e.target.value)} autoComplete="off" aria-label="Exact confirmation text" /></label>}
   <div className="feature-actions"><Button onClick={()=>finish(false)}>Cancel</Button>
    <Button variant="primary" disabled={request.exact!==null&&input!==request.exact} onClick={()=>finish(true)}>Confirm</Button></div>
  </section></div>:null;
 return {ask,dialog};
}
function StateMessage({message,reason}:{message:string|null;reason:string|null}){
 return message?<p role="status" className="native-action-message">{message}</p>:
  reason?<p role="status" className="muted">{deviceErrorMessage(reason)}</p>:null;
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
  <div className="feature-kpi-grid">
   <Metric label="MODULE STATE" value={flags?(enabled?'Enabled':'Disabled'):'—'}><Database size={15} /> {flags?`Device revision ${flags.revision}`:'Module lifecycle not bound'}</Metric>
   <Metric label="MEMORY HOME" value={memory?(homes.length===1?homeName(homes[0]!):homes.length?`${homes.length} devices`:'No scopes'):'—'}><Server size={15} /> Each scope has its own Home</Metric>
   <Metric label="LOCAL STORAGE" value={bytes(memory?.localFileBytes??null)}><HardDrive size={15} /> Measured on this device; remote storage is separate</Metric>
  </div>
  <Card><div className="feature-section-title"><CardHeading description="Changes are saved immediately; disabling retains saved work">LONG MEMORY</CardHeading>
   <div className="feature-actions"><Button disabled={!flags||api.pending} variant={enabled?'secondary':'primary'}
    onClick={()=>flags&&void api.run('module.configure',{module:'longMemory',enabled:!enabled,expectedRevision:flags.revision})}>
     {api.pending?'Saving…':enabled?'Disable Long Memory':'Enable Long Memory'}</Button>
    <Button disabled={!accountId||api.pending} onClick={api.refresh}>Refresh</Button></div></div>
   {!enabled&&<p className="muted">{flags?'Long Memory is turned off on this device. Enable it to view retained scopes.':'The local Agent must verify this Owner before module controls are available.'}</p>}
   <StateMessage message={api.message} reason={api.reason} />
   {!flags&&<div className="feature-unavailable"><strong>Verified source unavailable</strong><p>Sign in and verify the local Agent to use this device's saved work.</p></div>}
  </Card>
  <div className="feature-split">
   <Card><CardHeading description="Account device policy, verified through the enrolled Agent">SYNC CONFIGURATION</CardHeading>
    {policy?<>
     <div className="feature-section-title"><strong>Sync {policy.enabled?'enabled':'disabled'}</strong>
      <Button disabled={api.pending} onClick={()=>void setSync(!policy.enabled)}>{policy.enabled?'Disable sync':'Enable sync'}</Button></div>
     <p className="muted">Revision {policy.revision} · last confirmed transfer: {stamp(memory?.lastConfirmedSyncAt??null)}</p>
     <p className="muted">Auto transfers approved scope updates; Follow Project requires a verified project binding; Manual transfers only after a request.</p>
    </>:<p className="muted">{enabled?'Account sync could not be verified. Local saved work remains available.':'Enable Long Memory to load sync settings.'}</p>}
   </Card>
   <Card><CardHeading description="Each saved checkbox/mode change is checked against the current account revision">REPLICA DEVICES</CardHeading>
    {policy&&sync?.devices?<div className="native-device-options">{sync.devices.map(device=>{
     const row=policy.devices.find(d=>d.deviceId===device.deviceId);
     return <div className="native-sync-device" key={device.deviceId}>
      <label><input type="checkbox" aria-label={'Sync '+(device.name||device.deviceId)} checked={row?.selected===true}
       disabled={!row||api.pending} onChange={e=>void setSync(policy.enabled,device.deviceId,e.target.checked)} />
       {device.name||device.deviceId}{device.deviceId===api.reply?.deviceId?' (this device)':''}<small className="muted"> · {device.state||'unknown'}</small></label>
      <select aria-label={'Sync mode '+(device.name||device.deviceId)} value={row?.mode||'auto'} disabled={!row||api.pending}
       onChange={e=>void setSync(policy.enabled,device.deviceId,undefined,e.target.value)}>
       <option value="auto">Auto</option><option value="follow_project">Follow Project</option><option value="manual">Manual</option></select>
      {row?.mode==='manual'&&<Button disabled={!policy.enabled||!row.selected||api.pending}
       onClick={()=>void api.run('memory.sync-manual',{deviceId:device.deviceId})}>Sync now</Button>}
     </div>;
    })}</div>:<div className="feature-empty"><strong>Replica list unavailable</strong><p>Device selection stays disabled until the signed account directory and sync policy are available.</p></div>}
   </Card>
  </div>
  <Card><CardHeading description="A new scope is created with this device as Home">MEMORY LIBRARY</CardHeading>
   {memory?.coverage&&memory.coverage.total>memory.coverage.returned&&<p role="status">Showing {memory.coverage.returned} of {memory.coverage.total} local scopes. Open Wall to inspect additional scopes.</p>}
   <form className="native-create-form" onSubmit={event=>void create(event)}>
    <input aria-label="New memory scope name" placeholder="New scope name" maxLength={240} value={name} onChange={e=>setName(e.target.value)} disabled={!enabled||api.pending} />
    <select aria-label="New scope capture mode" value={capture} onChange={e=>setCapture(e.target.value)} disabled={!enabled||api.pending}>
     <option value="manual">Manual capture</option><option value="auto">Auto capture</option></select>
    <Button type="submit" variant="primary" disabled={!enabled||!name.trim()||api.pending}>Create scope</Button>
   </form>
   <div className="feature-table feature-table-scroll" role="region" aria-label="Long Memory scopes"><table>
    <thead><tr><th>Scope</th><th>Home</th><th>Storage</th><th>Last confirmed sync</th><th>State / capture</th><th>Action</th></tr></thead>
    <tbody>{memory?.scopes.length?memory.scopes.map(scope=><tr key={scope.scopeId}>
     <td>{scope.displayName}<small className="muted"> · {scope.checkpoints??'—'} checkpoints</small></td>
     <td>{homeName(scope.homeDeviceId)}</td><td>{bytes(scope.bytes)}</td><td>{stamp(scope.lastConfirmedSyncAt)}</td>
     <td>{scope.tombstoned?'Deleted locally':scope.status}<br />{scope.captureMode}</td>
     <td><div className="feature-actions">
      {!scope.tombstoned&&<>
       <Button disabled={api.pending} onClick={()=>void lifecycle(scope,scope.status==='archived'?'restore':'archive')}>{scope.status==='archived'?'Restore':'Archive'}</Button>
       {scope.status==='active'&&scope.homeDeviceId===api.reply?.deviceId&&<Button disabled={api.pending}
        onClick={()=>void api.run('memory.capture',{scopeId:scope.scopeId,captureMode:scope.captureMode==='auto'?'manual':'auto'})}>{scope.captureMode==='auto'?'Use manual capture':'Enable auto capture'}</Button>}
       <Button disabled={api.pending} onClick={()=>void lifecycle(scope,'delete-local')}>Delete locally</Button>
       {scope.homeDeviceId===api.reply?.deviceId&&<Button disabled={api.pending} onClick={()=>void lifecycle(scope,'delete-account')}>Delete across account</Button>}
      </>}
     </div></td>
    </tr>):<tr><td colSpan={6}>{!flags?<><strong>Records not verified</strong><p>Enable controls require a verified local Agent.</p></>:enabled?'No saved scopes on this device':'Enable Long Memory to load saved scopes'}</td></tr>}</tbody>
   </table></div>
  </Card>{dialog}
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
  <div className="feature-split">
   <Card><CardHeading description="Optional per-device module; no task starts merely by opening this screen">CODEX BRIDGE</CardHeading>
    <div className="feature-status-hero"><TerminalSquare size={27} /><div><strong>{flags?(enabled?'Enabled':'Disabled'):'Module state unverified'}</strong>
     <p>{codex?`Controller: ${codex.recommendation||'waiting'}`:'No Codex process or observer is started by this screen.'}</p></div></div>
    <div className="feature-actions"><Button disabled={!flags||api.pending} variant={enabled?'secondary':'primary'} onClick={()=>flags&&void api.run('module.configure',{module:'codexBridge',enabled:!enabled,expectedRevision:flags.revision})}>
     {enabled?'Disable Codex Bridge':'Enable Codex Bridge'}</Button><Button disabled={!accountId||api.pending} onClick={api.refresh}>Refresh</Button></div>
    <StateMessage message={api.message} reason={api.reason} />
    {!flags&&<div className="feature-unavailable"><strong>Verified source unavailable</strong><p>Sign in and verify the local Agent before changing module state.</p></div>}
   </Card>
   <Card><CardHeading description="Device-local official Codex CLI and ChatGPT-plan login">RUNTIME STATUS</CardHeading>
    <div className="feature-pairs"><div><span>Codex runtime</span><strong>{codex?.runtime.state||'—'}</strong></div>
     <div><span>Account</span><strong>{account||'Not checked'}</strong></div>
     <div><span>Observer</span><strong>{codex?.operation?.state||'Idle'}</strong></div></div>
    {codex?.runtime.lastError&&<p role="alert">{deviceErrorMessage(codex.runtime.lastError)}</p>}
    {codex?.operation?.error&&<p role="alert">{deviceErrorMessage(codex.operation.error)}</p>}
    <div className="feature-actions">
     <Button disabled={!enabled||api.pending||codex?.runtime.installing} onClick={()=>void ask('Install the official optional Codex runtime on this device?').then(async yes=>{if(yes)await api.run('codex.runtime-install',{confirmed:true});})}>Install runtime</Button>
     <Button disabled={!enabled||!codex?.runtime.installed||api.pending||codex.runtime.installing} onClick={()=>void ask('Remove the managed Codex runtime? Saved tasks and memory remain on this device.').then(async yes=>{if(yes)await api.run('codex.runtime-remove',{confirmed:true});})}>Remove runtime</Button>
     <Button disabled={!enabled||api.pending} onClick={()=>void api.run('codex.account').then(r=>{if(r.state==='ready')setAccount(r.view.operation.connected?(r.view.operation.plan||'Connected'):'Signed out');})}>Check account</Button>
     <Button disabled={!enabled||api.pending} onClick={()=>void signIn()}>Sign in to Codex</Button>
     <Button disabled={!enabled||api.pending} onClick={()=>void ask('Sign this device out of Codex?').then(async yes=>{if(yes)await api.run('codex.logout',{confirmed:true});})}>Sign out of Codex</Button>
    </div>
    {login&&<><p role="status">Codex verification code: <strong>{login}</strong>. Complete sign-in in the browser, then Check account.</p>
     <Button disabled={api.pending} onClick={()=>void api.run('codex.login-cancel',{confirmed:true}).then(r=>{if(r.state==='ready')setLogin(null);})}>Cancel Codex sign-in</Button></>}
   </Card>
  </div>
  <Card><CardHeading description="Task state edits are recorded; Codex execution requires a separate explicit delegation">CODEX TASKS</CardHeading>
   {codex?.coverage&&codex.coverage.total>codex.coverage.returned&&<p role="status">Showing {codex.coverage.returned} of {codex.coverage.total} local tasks. Open Wall to inspect additional tasks.</p>}
   <form className="native-create-form" onSubmit={event=>void create(event)}><input aria-label="New Codex task title" value={title} maxLength={240}
    placeholder="Task title" disabled={!enabled||api.pending} onChange={e=>setTitle(e.target.value)} />
    <Button variant="primary" type="submit" disabled={!enabled||!title.trim()||api.pending}>Create task</Button></form>
   {editing&&<form className="native-create-form" onSubmit={event=>void saveEdit(event)}><input aria-label="Edit Codex task title" value={editTitle} maxLength={240} onChange={e=>setEditTitle(e.target.value)} />
    <Button type="submit" disabled={!editTitle.trim()||api.pending}>Save edit</Button><Button onClick={()=>setEditing(null)}>Cancel edit</Button></form>}
   <div className="feature-table feature-table-scroll" role="region" aria-label="Codex tasks"><table><thead><tr><th>Task</th><th>Updated</th><th>State</th><th>Action</th></tr></thead>
    <tbody>{codex?.tasks.length?codex.tasks.map(task=>{
     const delegation=codex.delegations.find(d=>d.taskId===task.id);
     return <tr key={task.id}><td>{task.title}</td><td>{stamp(task.changedAt)}</td><td>
      <select aria-label={'Task state '+task.title} value={task.state} disabled={api.pending} onChange={e=>void api.run('codex.task-state',{id:task.id,state:e.target.value,expectedChangedAt:task.changedAt})}>
       {['todo','working','waiting','done'].map(v=><option key={v} value={v}>{v}</option>)}</select>
      {delegation&&<small className="muted"> · {delegation.state} · {delegation.rounds}/{delegation.maxRounds} rounds</small>}</td>
      <td><div className="feature-actions"><Button disabled={api.pending} onClick={()=>{setEditing(task);setEditTitle(task.title);}}>Edit</Button>
       <Button disabled={api.pending} onClick={()=>void remove(task)}>Delete</Button>
       <Button disabled={api.pending||!['todo','working'].includes(task.state)} onClick={()=>void ask(`Allow Codex up to two work rounds for “${task.title}” in its device-owned workspace?`).then(async yes=>{if(yes)await api.run('codex.delegate',{taskId:task.id,goal:task.title,maxRounds:2,confirmed:true});})}>Delegate</Button>
       {delegation&&<Button disabled={api.pending} onClick={()=>void ask(`Pause the delegation for “${task.title}”?`).then(async yes=>{if(yes)await api.run('codex.pause',{taskId:task.id,confirmed:true});})}>Pause</Button>}</div></td></tr>;
    }):<tr><td colSpan={4}>{!flags?<><strong>Records not verified</strong><p>The optional module has not been verified.</p></>:enabled?'No local Codex tasks':'Enable Codex Bridge to load tasks'}</td></tr>}</tbody></table></div>
   <Button disabled={!enabled||api.pending||codex?.operation?.state==='running'} onClick={()=>void ask('Run the read-only Codex observer on this device? Recommendations do not automatically approve task changes.').then(async yes=>{if(yes)await api.run('codex.observe',{confirmed:true});})}>Run observer</Button>
  </Card>{dialog}
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
 const hostAction=async(action:'service'|'restart'|'update')=>{
  const text=action==='service'?(shell?.online?'Stop the background Agent? Its sessions and work may be interrupted.':'Start the background Agent on this device?'):
   action==='restart'?'Restart the background Agent on this device?':'Ask the installed updater to check the configured internal update policy?';
  if(acting.current||!await ask(text))return;
  if(!mounted.current||owner.current!==accountId)return;
  acting.current=true;const revision=++sequence.current;setShellBusy(true);setShellMessage(null);
  try{
   const result=await nativeShellAction(action);
   if(!mounted.current||owner.current!==accountId||revision!==sequence.current)return;
   setShellMessage(result.ok===true?String(result.state||'requested').replaceAll('_',' '):'The host action was not confirmed. Refresh its actual state.');
   const current=await nativeShellAction('status');
   if(!mounted.current||owner.current!==accountId||revision!==sequence.current)return;
   setShell(typeof current.wallOnline==='boolean'?{online:current.wallOnline}:null);
   api.refresh();
  }finally{acting.current=false;if(mounted.current)setShellBusy(false);}
 };
 const device=api.view?.device,log=api.view?.activityLog;
 return <>
  <Card><CardHeading description="The local host remains available when the Agent is stopped">AGENT &amp; CONNECTION</CardHeading>
   <div className="feature-pairs"><div><span>Agent</span><strong>{shell?shell.online?'Running':'Stopped':device?'Verified':'Not verified'}</strong></div>
    <div><span>Cloud</span><strong>{device?.cloudState||'Not verified'}</strong></div>
    <div><span>Installed Agent version</span><strong>{device?.version||'—'}</strong></div></div>
   <div className="feature-actions">
    {windows&&<><Button disabled={!shell||shellBusy} onClick={()=>void hostAction('service')}>{shell?.online?'Stop Agent':'Start Agent'}</Button>
     <Button disabled={shellBusy} onClick={()=>void hostAction('restart')}>Restart Agent</Button>
     <Button disabled={shellBusy} onClick={()=>void hostAction('update')}>Check update</Button></>}
    <Button disabled={!device||api.pending} onClick={()=>void ask(device?.cloudDesiredConnected?'Disconnect this device from Cloud? Active Agent access can be interrupted.':'Connect this enrolled device to Cloud?').then(async yes=>{
     if(yes)await api.run(device?.cloudDesiredConnected?'device.disconnect':'device.connect',{confirmed:true});
    })}>{device?.cloudDesiredConnected?'Disconnect Cloud':'Connect Cloud'}</Button>
    <Button disabled={api.pending} onClick={api.refresh}>Refresh device state</Button>
   </div>
   {shellMessage&&<p role="status">{shellMessage}</p>}<StateMessage message={api.message} reason={api.reason} />
  </Card>
  <Card><CardHeading description="Actual effective device policy; these rights are separate from an A/B grant">DEVICE &amp; OS PERMISSIONS</CardHeading>
   <p>Profile: <strong>{device?.policy.profile||'Not verified'}</strong> · revision {device?.policy.revision??'—'}</p>
   {device?<><p>Enabled: {device.policy.effectiveCapabilities.length?device.policy.effectiveCapabilities.join(', '):'None reported'}</p>
    <p>Locally denied: {device.policy.deniedCapabilities.length?device.policy.deniedCapabilities.join(', '):'None reported'}</p></>:<p className="muted">Verify the enrolled local Agent to read policy.</p>}
  </Card>
  <Card className="activity-logs-card"><CardHeading description="Device-local history with mandatory disk rotation">ACTIVITY LOGS</CardHeading>
   {log?<div className="log-summary"><span>Disk usage</span><strong>{bytes(log.usedBytes)} / {bytes(log.maxDiskBytes)}</strong>
    <span>Recent RAM events</span><strong>{log.ramEvents}</strong>
    <label htmlFor="native-log-preset">Retention preset</label><select id="native-log-preset" value={log.preset} disabled={api.pending}
     onChange={e=>void api.run('logs.configure',{preset:e.target.value})}><option value="compact">Compact · 48 MiB</option><option value="standard">Standard · 200 MiB</option><option value="extended">Extended · 300 MiB</option></select></div>:
    <p className="muted">Log state is unavailable until the local Agent is verified.</p>}
   <Button disabled={!log||api.pending} onClick={()=>void ask('Clean the working activity logs on this device?','CLEAN ACTIVITY LOGS').then(async yes=>{
    if(yes)await api.run('logs.clean',{confirmed:true,confirmText:'CLEAN ACTIVITY LOGS'});
   })}>Clean activity logs</Button>
  </Card>{dialog}
 </>;
}
