import type {ReactNode} from 'react';
import {CircleHelp, Inbox, Search} from 'lucide-react';

const states:Record<string,{label:string;tone:string}>={
 online:{label:'Online',tone:'success'},connected:{label:'Connected',tone:'success'},
 active:{label:'Active',tone:'success'},ready:{label:'Ready',tone:'success'},
 enabled:{label:'On',tone:'success'},ok:{label:'Completed',tone:'success'},done:{label:'Done',tone:'success'},
 running:{label:'Running',tone:'info'},working:{label:'In progress',tone:'info'},
 queued:{label:'Queued',tone:'neutral'},dispatching:{label:'Starting',tone:'info'},
 hold:{label:'Waiting',tone:'warning'},waiting:{label:'Waiting',tone:'warning'},
 stop_requested:{label:'Stopping',tone:'warning'},'stop-requested':{label:'Stopping',tone:'warning'},
 error:{label:'Failed',tone:'danger'},failed:{label:'Failed',tone:'danger'},
 timeout:{label:'Timed out',tone:'warning'},killed:{label:'Stopped',tone:'neutral'},
 closed:{label:'Closed',tone:'neutral'},expired:{label:'Expired',tone:'neutral'},
 offline:{label:'Offline',tone:'neutral'},disconnected:{label:'Disconnected',tone:'neutral'},
 archived:{label:'Archived',tone:'neutral'},todo:{label:'To do',tone:'neutral'},
 disabled:{label:'Off',tone:'neutral'},unknown:{label:'Not available',tone:'neutral'}
};
export function stateLabel(value:string|null|undefined){return states[value||'unknown']?.label||'Not available';}
export function StatusBadge({value,label}:{value?:string|null;label?:string}){
 const state=states[value||'unknown']||states.unknown!;
 return <span className={'product-badge tone-'+state.tone}><span aria-hidden="true" />{label||state.label}</span>;
}
export function EmptyState({title,children}:{title:string;children?:ReactNode}){
 return <div className="product-empty"><Inbox size={25} aria-hidden="true"/><h3>{title}</h3>{children&&<p>{children}</p>}</div>;
}
export function DetailNote({title='Technical details',children}:{title?:string;children:ReactNode}){
 return <details className="product-details"><summary><CircleHelp size={15} aria-hidden="true"/>{title}</summary><div className="product-details-body">{children}</div></details>;
}
export function RecordDetails({label='Details',rows}:{label?:string;rows:ReadonlyArray<readonly[string,ReactNode]>}){
 return <details className="record-details"><summary>{label}</summary><dl>{rows.map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value??'Not available'}</dd></div>)}</dl></details>;
}
export function DateLabel({value,empty='Not available'}:{value:number|null|undefined;empty?:string}){
 if(value===null||value===undefined)return <span className="muted">{empty}</span>;
 const date=new Date(value);
 if(!Number.isFinite(date.getTime()))return <span className="muted">{empty}</span>;
 return <time dateTime={date.toISOString()} title={date.toLocaleString()}>{date.toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time>;
}
export function SearchField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){
 return <label className="product-search"><Search size={17} aria-hidden="true"/><input type="search" aria-label={label} placeholder={label} value={value} onChange={e=>onChange(e.target.value)}/></label>;
}
export function CountNote({shown,loaded,total}:{shown:number;loaded:number;total:number}){
 return <span className="muted">{shown===total?`${total} ${total===1?'record':'records'}`:`Showing ${shown} of ${total}${loaded<total?' · more available':''}`}</span>;
}
export function platformLabel(os:string|null){
 if(!os)return 'Not available';
 return ({win32:'Windows',windows:'Windows',darwin:'macOS',macos:'macOS',linux:'Linux'} as Record<string,string>)[os.toLowerCase()]||os;
}
export function deviceName(devices:ReadonlyArray<{deviceId:string;name:string|null}>,id:string){
 return devices.find(d=>d.deviceId===id)?.name||'Unnamed device';
}
export function agentName(sessions:ReadonlyArray<{agentId:string|null;name:string|null}>,id:string|null){
 return sessions.find(s=>id!==null&&s.agentId===id&&s.name)?.name||'AI agent';
}
const eventLabels:Record<string,string>={
 node_command_queued:'Task added to the queue',node_command_dispatched:'Task started',
 job_started:'Task started',job_finished:'Task finished',stdout:'Task sent output',stderr:'Task sent a diagnostic message',
 session_hold_released:'Agent resumed work',session_hold:'Agent is waiting',session_created:'Session opened',
 session_closed:'Session closed',session_expired:'Session expired',device_connected:'Device connected',
 device_disconnected:'Device disconnected',command_started:'Task started',command_finished:'Task finished',
 lease_renewed:'Session extended',heartbeat:'Device checked in'
};
export function eventLabel(eventType:string){return eventLabels[eventType]||'Device activity';}
