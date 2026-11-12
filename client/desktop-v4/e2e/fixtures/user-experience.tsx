// LIGHT_REMOTE_UX_FIXTURE_ONLY — never imported by the production entrypoint.
// All accounts, names, IDs and state below are synthetic and memory-only.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceShell} from '../../src/WorkspaceShell';
import {Overview,AiAccess,SettingsPage} from '../../src/WorkspaceViews';
import {FeatureScreen} from '../../src/FeatureScreens';
import {AuthEntry} from '../../src/AuthEntry';
import {DeviceLinkDialog} from '../../src/DeviceLinkDialog';
import {useDeviceConfirmation} from '../../src/NativeModuleScreens';
import type {RouteKey} from '../../src/lib/routes';
import type {OwnerSnapshot} from '../../src/lib/native-snapshot';
import authFont from '../../../../assets/fonts/web/GoogleSans-Variable.ttf?url';
import authCss from '../../../../assets/branding/auth-pages.css?raw';
import authLogo from '../../../../assets/branding/light-remote-mark.svg?raw';
import {WEB_FONT_FACE_CSS} from '../../../../lib/web-typography.mjs';
import {desktopConsentPage} from '../../../../plugin-server/desktop-consent-page.mjs';
import '../../src/styles.css';
const now=Date.now(),owner='ux-owner',deviceId='ux-workstation';
const params=new URLSearchParams(location.search),long=params.get('long')==='1';
const name=long?'Design workstation with a very long name — product research, development and customer support':'Design workstation';
const snapshot:OwnerSnapshot={state:'ready',accountId:owner,asOf:now,
 account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true},entitlements:{plan:'pro',toolCallLimit:10000},
 usage:{month:'2026-11',toolCallsThisMonth:5080,byDevice:[{deviceId,toolCalls:4595,onlineMs:259200000},{deviceId:'ux-laptop',toolCalls:485,onlineMs:68000000}]},
 devices:[{deviceId,name,shortId:'DESK22',os:'win32',state:'online',lastSeenAt:now},{deviceId:'ux-laptop',name:'Travel laptop',shortId:'TRAV33',os:'darwin',state:'offline',lastSeenAt:now-86400000}],
 sessions:[{sessionId:'s-current',deviceId,agentId:'agent-ui',name:'Project assistant',state:'active',createdAt:now-600000,lastSeenAt:now,expiresAt:now+3600000,holdReason:null,activeJobs:1},...Array.from({length:25},(_,i)=>({sessionId:'s-history-'+i,deviceId,agentId:'agent-'+i,name:'Previous project '+(i+1),state:'expired' as const,createdAt:now-(i+1)*3600000,lastSeenAt:now-(i+1)*3500000,expiresAt:now-(i+1)*3000000,holdReason:null,activeJobs:0}))],
 grants:[{grantId:'grant-fixture',deviceId,agentId:'agent-ui',approvedAt:now-3600000,expiresAt:now+82000000,absoluteExpiresAt:now+82000000}],
 jobs:Array.from({length:120},(_,i)=>({jobId:'synthetic-job-'+String(i).padStart(8,'0'),deviceId:i%7===0?'ux-laptop':deviceId,agentId:'agent-ui',sessionId:'s-current',state:i===0?'running':i%9===0?'timeout':i%5===0?'error':'ok',startedAt:now-i*40000,finishedAt:i===0?null:now-i*40000+5000,exitCode:i%5===0?1:0})),
 events:Array.from({length:187},(_,i)=>({deviceId,eventType:['job_finished','stdout','node_command_dispatched','session_hold_released'][i%4]!,status:i%4===0?'ok':'running',at:now-i*6000})),
 coverage:{jobs:{returned:120,total:120,hasMore:false,source:'in_memory_current_window'},sessions:{returned:26,total:26,hasMore:false,activeTotal:1,holdTotal:0,source:'in_memory_current_window'}}
};
const device={deviceName:name,cloudDesiredConnected:true,cloudState:'connected',version:'0.10.1-dev.9',platform:'win32',executorReady:true,policy:{profile:'standard',revision:4,effectiveCapabilities:['fs.read','fs.write','process.run'],deniedCapabilities:['desktop.capture']}};
const modules={longMemory:true,codexBridge:true,revision:9};
const codexSession={account:{state:'ready',connected:true,plan:'plus'},login:null,
 catalog:{state:'ready',asOf:now,models:[{model:'fixture-model',displayName:'Fixture model for project work',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:[{reasoningEffort:'high',description:'More careful reasoning for project work'},{reasoningEffort:'max',description:'Maximum fixture reasoning'}]}]},selection:{model:'fixture-model',reasoningEffort:'high'},
 quota:{state:'ready',asOf:now,buckets:[{id:'fixture-quota',name:'Codex usage',primary:{usedPercent:37,windowDurationMins:300,resetsAt:Math.floor((now+3600000)/1000)},secondary:{usedPercent:12,windowDurationMins:10080,resetsAt:Math.floor((now+86400000)/1000)}}]},
 accountUsage:{state:'ready',asOf:now,lifetimeTokens:120000,daily:[{date:'2026-11-10',tokens:4000}]},
 usage:{state:'ready',asOf:now,total:{totalTokens:4100,inputTokens:3000,cachedInputTokens:1000,outputTokens:1100,reasoningOutputTokens:500},last:{totalTokens:4100,inputTokens:3000,cachedInputTokens:1000,outputTokens:1100,reasoningOutputTokens:500},model:'fixture-model',reasoningEffort:'high'}};

Object.assign(window,{__TAURI_INTERNALS__:{invoke:async(command:string,args:Record<string,unknown>={})=>{
 if(command==='desktop_native_action')return args.action==='preview'?{ok:true,state:'pending',deviceCode:'TEST-CODE',expiresAt:now+120000}:{ok:true,Enrolled:true,connected:false,ShortId:'DESK22',wallOnline:true};
 if(command!=='desktop_owner_device_request'||args.expectedAccountId!==owner)throw Error('fixture_call_denied');
 const base={ok:true,accountId:owner,deviceId,view:{asOf:Date.now(),modules,device,activityLog:{preset:'standard',usedBytes:12*1048576,maxDiskBytes:200*1048576,ramEvents:128},operation:{state:'ready'}}};
 if(args.action==='memory.read')return {...base,view:{...base.view,memory:{localFileBytes:14*1048576,liveBytes:10*1048576,checkpointBytes:4*1048576,coverage:{returned:3,total:3},lastConfirmedSyncAt:now-600000,
  scopes:Array.from({length:3},(_,i)=>({scopeId:'memory-'+i,displayName:['Website redesign','Product launch','Customer support notes'][i],homeDeviceId:deviceId,status:i===2?'archived':'active',tombstoned:false,captureMode:'manual',revision:1,checkpoints:3+i,bytes:(i+1)*1048576,lastConfirmedSyncAt:now-600000})),sync:{state:'ready',currentDeviceId:deviceId,devices:[{deviceId,name,state:'online',online:true},{deviceId:'ux-laptop',name:'Travel laptop',state:'offline',online:false}],policy:{enabled:true,revision:2,devices:[{deviceId,selected:true,mode:'auto',manualRequestSeq:null},{deviceId:'ux-laptop',selected:true,mode:'manual',manualRequestSeq:null}]}}}}};
 if(args.action==='codex.read')return {...base,view:{...base.view,codex:{session:codexSession,tasks:[{id:'task-fixture',title:long?'Review the complete checkout and subscription settings workflow for returning customers':'Review the checkout flow',state:'todo',createdAt:now,changedAt:now}],coverage:{returned:1,total:1},recommendation:'observe',runtime:{state:'installed',installed:true,externalAvailable:false,installing:false,lastError:null},operation:{state:'idle',error:null},delegations:[]}}};
 if(String(args.action).endsWith('.read'))return base;
 throw Error('fixture_mutation_not_available');
}}});
const status={phase:'settled' as const,result:{state:'ready' as const,device:{verifiedAt:now,deviceName:name,connection:'connected' as const,cloudState:'connected'}}};
const pending={state:'ready' as const,deviceId,shortId:'DESK22',ownerApproveEnabled:true,ownerConsentRequired:false,pending:[{requestId:'av2_'+('a'.repeat(32)),attempt:1,aCode:'DESK22-ABCDE',expiresAt:now+240000}]};
function Fixture(){
 const [route,setRoute]=React.useState<RouteKey>((params.get('route')||'overview') as RouteKey),[theme,setTheme]=React.useState<'light'|'dark'|'system'>((params.get('theme')||'light') as 'light'|'dark');
 const [link,setLink]=React.useState(params.get('dialog')==='link');
 const confirmation=useDeviceConfirmation(owner);
 React.useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 React.useEffect(()=>{if(params.get('dialog')==='confirm')void confirmation.ask('Delete this saved project from this PC? Other devices and backups will be retained.','Website redesign');},[]);
 if(route==='login' as RouteKey)return <AuthEntry allowDesignPreview={false} onPreviewWorkspace={()=>{}} nativePhase="signed_out" onBrowserSignIn={()=>{}} onLinkDevice={()=>setLink(true)}/>;
 const content=route==='overview'?<Overview status={status} navigate={setRoute} wallProbe="unavailable" abv2={pending} snapshot={snapshot}/>:route==='ai-access'?<AiAccess status={status} native={pending} refresh={()=>{}} approving={false} onApprove={async()=>true} snapshot={snapshot} ownerAccountId={owner}/>:route==='settings'?<SettingsPage theme={theme} choose={setTheme} status={status} openWall={()=>{}} canOpenWall={true} accountId={owner}/>:<FeatureScreen route={route} status={status.result} snapshot={snapshot} ownerAccountId={owner} localDeviceId={deviceId} onLinkDevice={()=>setLink(true)}/>;
 return <WorkspaceShell route={route} navigate={setRoute} status={status} wallProbe="unavailable" preview={true} accountEmail="owner@example.test" canOpenWall={true} onOpenWall={()=>{}} onRefresh={()=>{}} onSignOut={()=>{}} onLinkDevice={()=>setLink(true)}>{content}{link&&<DeviceLinkDialog onClose={()=>setLink(false)}/>} {confirmation.dialog}</WorkspaceShell>;
}
if(params.get('route')==='consent'){
 document.open();document.write(desktopConsentPage({presentation:{css:WEB_FONT_FACE_CSS.replace('/assets/fonts/GoogleSans-Variable.ttf',authFont)+authCss,logo:authLogo},csrf:'synthetic-fixture-csrf',formAction:'/fixture-deny-submit'}));document.close();
}else createRoot(document.getElementById('root')!).render(<Fixture/>);
