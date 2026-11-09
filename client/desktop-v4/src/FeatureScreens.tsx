import {useState,type ReactNode} from 'react';
import {Activity,Clock3,Monitor,Users,Wifi,HardDrive,type LucideIcon} from 'lucide-react';
import {LongMemoryScreen,CodexBridgeScreen,useDeviceConfirmation} from './NativeModuleScreens';
import {useNativeDevice} from './lib/native-device';
import {Button} from './components/ui/button';
import {Card,CardHeading} from './components/ui/card';
import {StatusBadge,EmptyState,DetailNote,RecordDetails,DateLabel,SearchField,CountNote,platformLabel,deviceName,agentName,eventLabel} from './components/ProductUi';
import type {RouteKey} from './lib/routes';
import type {SnapshotResult} from './lib/status';
import type {OwnerSnapshot,OwnerDevice,OwnerJob,OwnerSession} from './lib/native-snapshot';
import type {UsageDeviceRow} from './lib/native-activity';
import {useOwnerActivity} from './lib/use-owner-activity';
import {useOwnerInventory} from './lib/use-owner-inventory';

export type FeatureRoute=Extract<RouteKey,'sessions'|'live-monitor'|'devices'|'long-memory'|'codex-bridge'|'account'>;
function Metric({label,hint,icon:Icon,value='—'}:{label:string;hint:string;icon:LucideIcon;value?:string}){
 return <Card className="feature-kpi"><div className="feature-kpi-top"><span className="eyebrow">{label}</span><Icon size={18} aria-hidden="true"/></div><strong className="feature-kpi-value">{value}</strong><span className="muted">{hint}</span></Card>;
}
function Unavailable({children}:{children:ReactNode}){
 return <div className="feature-unavailable" role="status"><div><strong>Unable to load this information</strong><p>{children}</p></div></div>;
}
function Tabs({value,onChange,items,label}:{value:string;onChange:(value:string)=>void;items:ReadonlyArray<readonly[string,string]>;label:string}){
 return <div className="product-tabs" role="group" aria-label={label}>{items.map(([key,text])=><button type="button" key={key} aria-pressed={key===value} onClick={()=>onChange(key)}>{text}</button>)}</div>;
}
function Sessions({snapshot,ownerAccountId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null}){
 const local=useNativeDevice('device.read',ownerAccountId),{ask,dialog}=useDeviceConfirmation(ownerAccountId);
 const activity=useOwnerActivity('sessions',snapshot?ownerAccountId:null);
 const paged=Boolean(snapshot&&ownerAccountId&&activity.pages.length>0);
 const retention=paged?activity.pages[0]?.coverage.retention:undefined;
 const rows:ReadonlyArray<OwnerSession>=paged?activity.rows.filter((row):row is OwnerSession=>'createdAt' in row):snapshot?.sessions||[];
 const coverage=snapshot?.coverage?.sessions;
 const active=coverage?.activeTotal??rows.filter(s=>s.state==='active').length;
 const hold=coverage?.holdTotal??rows.filter(s=>s.state==='hold').length;
 const [filter,setFilter]=useState('current'),[query,setQuery]=useState(''),[limit,setLimit]=useState(20);
 const filtered=rows.filter(s=>(filter==='all'||(filter==='current'?['active','hold'].includes(s.state):!['active','hold'].includes(s.state)))&&
  [s.name,deviceName(snapshot?.devices||[],s.deviceId),s.sessionId].join(' ').toLowerCase().includes(query.toLowerCase()));
 const visible=filtered.slice(0,limit);
 const expiry=rows.filter(s=>['active','hold'].includes(s.state)&&s.expiresAt!==null).reduce<number|null>((soon,s)=>soon===null?s.expiresAt:Math.min(soon,s.expiresAt!),null);
 return <div className="screen-content feature-dashboard">
  <div className="feature-kpi-grid"><Metric label="Working now" hint="Sessions doing work" icon={Users} value={snapshot?String(active):'—'}/><Metric label="Waiting" hint="Sessions ready to continue" icon={Clock3} value={snapshot?String(hold):'—'}/><Metric label="Next session ends" hint={coverage?.hasMore?'Among loaded sessions':'Current session deadline'} icon={Clock3} value={expiry===null?'—':new Date(expiry).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}/></div>
  <Card><CardHeading description="See who is working and manage sessions on this PC.">Your AI sessions</CardHeading>
   <div className="product-toolbar"><Tabs label="Session view" value={filter} onChange={v=>{setFilter(v);setLimit(20);}} items={[["current","Current"],["history","History"],["all","All sessions"]]}/><SearchField label="Find a session" value={query} onChange={v=>{setQuery(v);setLimit(20);}}/></div>
   <div className="feature-table feature-table-scroll" role="region" aria-label="AI sessions"><table><thead><tr><th>Agent</th><th>Device</th><th>Status</th><th>Ends</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
    {visible.length?visible.map(row=><tr key={row.sessionId}><td><strong className="cell-title">{row.name||'AI agent'}</strong>{row.activeJobs!==null&&row.activeJobs>0&&<span className="cell-meta">{row.activeJobs} {row.activeJobs===1?'task':'tasks'} in progress</span>}</td><td>{deviceName(snapshot?.devices||[],row.deviceId)}</td><td><StatusBadge value={row.state}/></td><td><DateLabel value={row.expiresAt} empty={['closed','expired'].includes(row.state)?'Ended':'No deadline reported'}/></td><td><div className="row-actions">
     {local.reply?.deviceId===row.deviceId&&row.agentId&&['active','hold'].includes(row.state)&&<Button disabled={local.pending} onClick={()=>void ask(`Close the session for ${row.name||'this AI agent'} on this PC?`).then(async yes=>{if(yes)await local.run('sessions.close',{sessionId:row.sessionId,agentId:row.agentId,confirmed:true});})}>Close session</Button>}
     <RecordDetails label={'Details for '+(row.name||'AI agent')} rows={[["Session ID",row.sessionId],["Agent ID",row.agentId],["Started",<DateLabel value={row.createdAt}/>],["Last activity",<DateLabel value={row.lastSeenAt}/>],["Waiting reason",row.holdReason],["Control",local.reply?.deviceId===row.deviceId?'This PC':'Open Desktop on this session’s device to close it']]}/>
    </div></td></tr>):<tr><td colSpan={5}><EmptyState title={!snapshot?'Sign in to see your sessions':query?'No matching sessions':filter==='current'?'No sessions working right now':'No sessions to show'}>{snapshot?'Approved AI agents will appear here. Use History to see previous sessions.':'Your account sessions will appear after signing in and connecting.'}</EmptyState></td></tr>}
   </tbody></table></div>
   <div className="product-list-footer"><CountNote shown={visible.length} loaded={rows.length} total={paged?(activity.total??rows.length):coverage?.total??rows.length}/>{filtered.length>limit?<Button onClick={()=>setLimit(x=>x+20)}>Show more sessions</Button>:paged&&activity.hasMore?<Button disabled={activity.pending} onClick={()=>void activity.loadMore()}>{activity.pending?'Loading…':'Load more sessions'}</Button>:null}</div>
   <DetailNote title="About session history"><p>Showing {rows.length} of {paged?(activity.total??rows.length):coverage?.total??rows.length} Owner sessions. This is a recent session window. Not an immutable audit archive. Older sessions may no longer be available.</p>{retention&&<p>Redis snapshot TTL: {Math.round(retention.snapshotTtlSeconds/86400)} days (renewed on writes). Terminal sessions are pruned after {Math.round(retention.terminalPruneAfterMs/86400000)} days from closure or expiry.</p>}</DetailNote>
  </Card>{activity.error&&<Unavailable>Session history could not refresh. Try again using Refresh.</Unavailable>}{local.message&&<p role="status" className="native-action-message">{local.message}</p>}{dialog}
  {!snapshot&&<Unavailable>Sign in to your account, then refresh. A device connection alone does not give access to account sessions.</Unavailable>}
 </div>;
}
const runningStates=new Set(['running','queued','dispatching','stop_requested','stop-requested']);
const problemStates=new Set(['error','failed','timeout','killed']);
function LiveMonitor({status,snapshot,ownerAccountId}:{status:SnapshotResult|null;snapshot:OwnerSnapshot|null;ownerAccountId:string|null}){
 const local=useNativeDevice('device.read',ownerAccountId),{ask,dialog}=useDeviceConfirmation(ownerAccountId);
 const v=status?.state==='ready'?status.device:null;
 const connection=v?.connection==='connected'?'Connected':v?.connection==='disconnected'?'Disconnected':'—';
 const activity=useOwnerActivity('jobs',ownerAccountId);
 const paged=Boolean(ownerAccountId)&&activity.pages.length>0;
 const rows:ReadonlyArray<OwnerJob>=paged?activity.rows.filter((row):row is OwnerJob=>'jobId' in row):snapshot?.jobs||[];
 const events=snapshot?.events||[];
 const incomplete=snapshot?.coverage?.jobs.hasMore===true;
 const [filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[limit,setLimit]=useState(10),[eventLimit,setEventLimit]=useState(5);
 const filtered=rows.filter(j=>(filter==='all'||(filter==='running'?runningStates.has(j.state):problemStates.has(j.state)))&&
  [deviceName(snapshot?.devices||[],j.deviceId),agentName(snapshot?.sessions||[],j.agentId),j.jobId].join(' ').toLowerCase().includes(query.toLowerCase())).slice().sort((a,b)=>(b.startedAt??0)-(a.startedAt??0));
 const visible=filtered.slice(0,limit);
 const recent=events.slice().sort((a,b)=>(b.at??0)-(a.at??0));
 return <div className="screen-content feature-dashboard">
  <div className="feature-kpi-grid"><Metric label="This PC" hint={v?'Connection to your account':'Connection status unavailable'} icon={Wifi} value={connection}/><Metric label="In progress" hint={incomplete?'At least this many in recent activity':'Tasks in the current activity window'} icon={Activity} value={snapshot?(incomplete?'≥':'')+String(snapshot.jobs.filter(j=>runningStates.has(j.state)).length):'—'}/><Metric label="Recent updates" hint="Activity from your devices" icon={Clock3} value={snapshot?String(events.length):'—'}/></div>
  <div className="monitor-bottom"><Card><CardHeading description="The latest updates, newest first.">Recent activity</CardHeading><div role="region" aria-label="Live activity events">
   {recent.length?<ol className="activity-timeline">{recent.slice(0,eventLimit).map((e,i)=><li key={e.deviceId+'-'+e.at+'-'+e.eventType+'-'+i}><span className={'timeline-dot '+(problemStates.has(e.status)?'timeline-error':'')} aria-hidden="true"/><div className="timeline-content"><strong>{eventLabel(e.eventType)}</strong><span className="cell-meta">{deviceName(snapshot?.devices||[],e.deviceId)}</span><RecordDetails label="Event details" rows={[["Event type",e.eventType],["State",e.status],["Device ID",e.deviceId],["At",<DateLabel value={e.at}/>]]}/></div><DateLabel value={e.at}/></li>)}</ol>:<EmptyState title="No recent updates">Activity appears when an AI agent starts work.</EmptyState>}
   {recent.length>eventLimit&&<Button onClick={()=>setEventLimit(x=>x+12)}>Show more activity</Button>}
  </div></Card><Card className="monitor-device"><CardHeading description="Availability of this PC for AI work.">This device</CardHeading><div className="feature-pairs"><div><span>Connection</span><strong>{connection}</strong></div><div><span>Ready for tasks</span><StatusBadge value={local.view?.device?.executorReady===true?'ready':local.view?.device?.executorReady===false?'hold':'unknown'} label={local.view?.device?.executorReady===false?'Not ready':undefined}/></div><div><span>Last update</span><DateLabel value={recent[0]?.at}/></div></div><p className="muted">Closing Desktop keeps the background Agent running.</p></Card></div>
  <Card className="monitor-jobs"><div className="feature-section-title"><CardHeading description="Follow work across your devices. Open a row for more information.">Task history</CardHeading>{snapshot&&<StatusBadge value="online" label="Updates automatically"/>}</div>
   <div className="product-toolbar"><Tabs label="Task view" value={filter} onChange={v=>{setFilter(v);setLimit(10);}} items={[["all","All tasks"],["running","In progress"],["issues","Needs attention"]]}/><SearchField label="Find a task or device" value={query} onChange={v=>{setQuery(v);setLimit(10);}}/></div>
   <div className="feature-table feature-table-scroll" role="region" aria-label="Agent jobs"><table><thead><tr><th>Task</th><th>Device</th><th>Status</th><th>Started</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
    {visible.length?visible.map(j=><tr key={j.jobId}><td><strong className="cell-title">{agentName(snapshot?.sessions||[],j.agentId)} task</strong><span className="cell-meta">{j.finishedAt!==null?'Finished':'Started'} <DateLabel value={j.finishedAt??j.startedAt}/></span></td><td>{deviceName(snapshot?.devices||[],j.deviceId)}</td><td><StatusBadge value={j.state}/></td><td><DateLabel value={j.startedAt}/></td><td><div className="row-actions">
     {local.reply?.deviceId===j.deviceId&&['running','queued','dispatching'].includes(j.state)&&<Button disabled={local.pending} onClick={()=>void ask('Stop this task on this PC? It may take a moment for the running task to finish stopping.').then(async yes=>{if(yes)await local.run('jobs.cancel',{jobId:j.jobId,confirmed:true});})}>Stop task</Button>}
     <RecordDetails label="Task details" rows={[["Job ID",j.jobId],["Agent ID",j.agentId],["Session ID",j.sessionId],["State",j.state],["Finished",<DateLabel value={j.finishedAt}/>],["Exit code",j.exitCode],["Control",local.reply?.deviceId===j.deviceId?'This PC':'View only on this PC']]}/>
    </div></td></tr>):<tr><td colSpan={5}><EmptyState title={!snapshot?'Waiting for your activity':filter==='issues'?'No tasks need attention':filter==='running'?'No tasks running':query?'No matching tasks':'No tasks yet'}>{snapshot?'Work from your approved AI agents appears here.':'Sign in and connect your device to see task updates.'}</EmptyState></td></tr>}
   </tbody></table></div>
   <div className="product-list-footer"><CountNote shown={visible.length} loaded={rows.length} total={paged?(activity.total??rows.length):snapshot?.coverage?.jobs.total??rows.length}/>{filtered.length>limit?<Button onClick={()=>setLimit(x=>x+10)}>Show more tasks</Button>:paged&&activity.hasMore?<Button disabled={activity.pending} onClick={()=>void activity.loadMore()}>{activity.pending?'Loading…':'Load more jobs'}</Button>:null}</div>
  </Card>
  <DetailNote title="About activity and task history"><p>{paged&&activity.pages[0]?.coverage.source==='postgresql_owner_job_history'?'Saved task history':'Current in-memory job window'}. Showing {rows.length} of {paged?(activity.total??rows.length):snapshot?.coverage?.jobs.total??rows.length} tasks. Task details are metadata; command text and output are not included in this view. A stop request remains pending until confirmed by the device.</p></DetailNote>
  {activity.error&&<Unavailable>Task history could not refresh. Previously loaded activity is shown; use Refresh to try again.</Unavailable>}{local.message&&<p role="status" className="native-action-message">{local.message}</p>}{dialog}
  {!snapshot&&<Unavailable>Account activity is unavailable. A connected local device does not authorize account history.</Unavailable>}
 </div>;
}
function Devices({snapshot,ownerAccountId,onLinkDevice,localDeviceId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null;onLinkDevice?:()=>void;localDeviceId?:string|null}){
 const needsPages=!snapshot||snapshot.coverage?.devices?.hasMore===true;
 const inventory=useOwnerInventory('devices',needsPages?ownerAccountId:null);
 const paged=needsPages&&inventory.pages.length>0,partial=Boolean(snapshot?.coverage?.devices?.hasMore);
 const rows:ReadonlyArray<OwnerDevice>=paged?inventory.rows.filter((row):row is OwnerDevice=>'shortId' in row):snapshot?.devices||[];
 const verified=Boolean(snapshot)||paged;
 const [query,setQuery]=useState('');
 const filtered=rows.filter(d=>[d.name,d.shortId,platformLabel(d.os)].join(' ').toLowerCase().includes(query.toLowerCase()));
 return <div className="screen-content feature-dashboard"><div className="feature-kpi-grid"><Metric label="Your devices" hint="Linked to your account" icon={Monitor} value={verified?String(paged?(inventory.total??rows.length):partial?snapshot?.coverage?.devices?.total:rows.length):'—'}/><Metric label="Online now" hint={(paged&&inventory.hasMore)||partial?'Among loaded devices':'Available for AI work'} icon={Wifi} value={verified?((paged&&inventory.hasMore)||partial?'≥':'')+String(rows.filter(d=>d.state==='online').length):'—'}/><Metric label="Offline" hint="Reconnect on the device when needed" icon={HardDrive} value={verified?((paged&&inventory.hasMore)||partial?'≥':'')+String(rows.filter(d=>d.state==='offline').length):'—'}/></div>
  <Card><div className="feature-section-title"><CardHeading description="Keep track of the computers linked to your account.">Your devices</CardHeading>{onLinkDevice&&<Button variant="primary" onClick={onLinkDevice}>Link / Relink this PC</Button>}</div><div className="product-toolbar"><SearchField label="Find a device" value={query} onChange={setQuery}/>{!onLinkDevice&&<span className="muted">To link this PC: Windows Tray → Link / Relink</span>}</div>
   <div className="feature-table feature-table-scroll" role="region" aria-label="Devices inventory"><table><thead><tr><th>Device</th><th>System</th><th>Status</th><th>Last seen</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{filtered.length?filtered.map(d=><tr key={d.deviceId}><td><strong className="cell-title">{d.name||'Unnamed device'}</strong><span className="cell-meta">{d.deviceId===localDeviceId?'This PC · ':''}{d.shortId||'No short ID'}</span></td><td>{platformLabel(d.os)}</td><td><StatusBadge value={d.state}/></td><td><DateLabel value={d.lastSeenAt}/></td><td><RecordDetails label="Device details" rows={[["Device ID",d.deviceId],["Short ID",d.shortId],["Platform",d.os]]}/></td></tr>):<tr><td colSpan={5}><EmptyState title={verified?query?'No matching devices':'No linked devices yet':'Sign in to see your devices'}>Link this PC to get started. Linking a device does not approve AI access.</EmptyState></td></tr>}</tbody></table></div>
   <div className="product-list-footer"><CountNote shown={filtered.length} loaded={rows.length} total={paged?(inventory.total??rows.length):snapshot?.coverage?.devices?.total??rows.length}/>{paged&&inventory.hasMore&&<Button disabled={inventory.pending} onClick={()=>void inventory.loadMore()}>{inventory.pending?'Loading…':'Load more devices'}</Button>}</div>
  </Card>{inventory.error&&<Unavailable>Your device list could not refresh. Try again with Refresh.</Unavailable>}{!verified&&<Unavailable>Sign in to load your devices. Device linking and AI access approvals are separate steps.</Unavailable>}
 </div>;
}
function Account({snapshot,ownerAccountId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null}){
 const needsPage=snapshot?.coverage?.usage?.hasMore===true;
 const activity=useOwnerActivity('usage',needsPage?ownerAccountId:null),paged=needsPage&&activity.pages.length>0;
 const usageRows:ReadonlyArray<UsageDeviceRow>=paged?activity.rows.filter((row):row is UsageDeviceRow=>'toolCalls' in row):snapshot?.usage.byDevice||[];
 const allowance=snapshot?.entitlements.toolCallLimit,used=snapshot?.usage.toolCallsThisMonth;
 const month=snapshot?.usage.month?new Date(snapshot.usage.month+'-01T12:00:00Z').toLocaleDateString(undefined,{month:'long',year:'numeric'}):'—';
 return <div className="screen-content feature-dashboard"><div className="feature-split account-summary"><Card><CardHeading>Your account</CardHeading><div className="feature-identity"><div className="feature-avatar" aria-hidden="true">{snapshot?.account.email?.[0]?.toUpperCase()||'?'}</div><div><strong>{snapshot?.account.email||'Account information unavailable'}</strong><p>{snapshot?'Signed in':'Sign in to load your profile'}</p></div></div><p className="muted">Your devices and AI access stay with this account.</p></Card><Card><CardHeading description="Your current account subscription.">Your plan</CardHeading><strong className="plan-name">{snapshot?.account.plan?.toUpperCase()||'Not available'}</strong><div className="feature-pairs"><div><span>Monthly allowance</span><strong>{allowance===null||allowance===undefined?'Not provided':allowance.toLocaleString()+' calls'}</strong></div><div><span>Used this month</span><strong>{used===null||used===undefined?'Not available':used.toLocaleString()+' calls'}</strong></div></div>{typeof allowance==='number'&&allowance>0&&typeof used==='number'&&<progress aria-label="Monthly call usage" max={allowance} value={Math.min(used,allowance)}/>}</Card></div>
  <div className="feature-kpi-grid"><Metric label="Calls this month" hint="AI tool calls across your devices" icon={Activity} value={snapshot&&used!==null&&used!==undefined?used.toLocaleString():'—'}/><Metric label="Linked devices" hint="In your account" icon={Monitor} value={snapshot?String(snapshot.coverage?.devices?.total??snapshot.devices.length):'—'}/><Metric label="Usage period" hint="Monthly usage · UTC" icon={Clock3} value={month}/></div>
  <Card><CardHeading description="How your devices have used Light Remote this month.">Usage by device</CardHeading><div className="feature-table feature-table-scroll" role="region" aria-label="Usage by device"><table><thead><tr><th>Device</th><th>Calls</th><th>Time online</th></tr></thead><tbody>{usageRows.length?usageRows.map(row=><tr key={row.deviceId}><td><strong className="cell-title">{deviceName(snapshot?.devices||[],row.deviceId)}</strong></td><td>{row.toolCalls?.toLocaleString()??'Not available'}</td><td>{row.onlineMs===null?'Not available':(row.onlineMs/3600000).toFixed(1)+' hours'}</td></tr>):<tr><td colSpan={3}><EmptyState title={snapshot?'No usage recorded this month':'Usage is unavailable'}>Your monthly device usage appears here after signing in.</EmptyState></td></tr>}</tbody></table></div>
   {snapshot?.coverage?.usage?.hasMore&&<div className="product-list-footer"><CountNote shown={usageRows.length} loaded={usageRows.length} total={paged?(activity.total??usageRows.length):snapshot.coverage.usage.total}/>{paged&&activity.hasMore&&<Button disabled={activity.pending} onClick={()=>void activity.loadMore()}>{activity.pending?'Loading…':'Load more usage'}</Button>}</div>}
   <DetailNote title="About usage"><p>Usage period: {snapshot?.usage.month||'Not available'}. Totals are supplied by your account service; live usage can change while pages load.</p></DetailNote>
  </Card>{activity.error&&<Unavailable>Some usage records could not refresh. Try again with Refresh.</Unavailable>}{!snapshot&&<Unavailable>Sign in and refresh to load your account, plan and usage.</Unavailable>}
 </div>;
}
export function FeatureScreen({route,status,snapshot,ownerAccountId=null,onLinkDevice,localDeviceId}:{route:FeatureRoute;status:SnapshotResult|null;snapshot?:OwnerSnapshot|null;ownerAccountId?:string|null;onLinkDevice?:()=>void;localDeviceId?:string|null}){
 const key=ownerAccountId||'signed-out';
 const scopedSnapshot=ownerAccountId&&snapshot?.accountId!==ownerAccountId?null:snapshot??null;
 switch(route){
  case 'sessions':return <Sessions key={key} snapshot={scopedSnapshot} ownerAccountId={ownerAccountId}/>;
  case 'live-monitor':return <LiveMonitor key={key} status={status} snapshot={scopedSnapshot} ownerAccountId={ownerAccountId}/>;
  case 'devices':return <Devices key={key} snapshot={scopedSnapshot} ownerAccountId={ownerAccountId} onLinkDevice={onLinkDevice} localDeviceId={localDeviceId}/>;
  case 'long-memory':return <LongMemoryScreen key={key} accountId={ownerAccountId}/>;
  case 'codex-bridge':return <CodexBridgeScreen key={key} accountId={ownerAccountId}/>;
  case 'account':return <Account key={key} snapshot={scopedSnapshot} ownerAccountId={ownerAccountId}/>;
 }
}
