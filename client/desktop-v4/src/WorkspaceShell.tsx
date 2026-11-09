import type {ReactNode} from 'react';
import {Activity,Database,House,Monitor,RefreshCcw,Settings,Shield,Terminal,UserRound,Users,ExternalLink,ChevronDown,type LucideIcon} from 'lucide-react';
import {Button} from './components/ui/button';
import {StatusBadge} from './components/ProductUi';
import {navRoutes,routeHref,type RouteKey} from './lib/routes';
import type {SnapshotResult} from './lib/status';
import type {NativeWallProbe} from './lib/native-wall-probe';
export type WorkspaceStatus={phase:'loading'|'settled';result:SnapshotResult|null};
const icons:Record<(typeof navRoutes)[number]['icon'],LucideIcon>={house:House,shield:Shield,users:Users,activity:Activity,monitor:Monitor,database:Database,terminal:Terminal,user:UserRound,settings:Settings};
export const screenTitles:Record<RouteKey,{title:string;subtitle:string}>={
 overview:{title:'Overview',subtitle:'Your devices, AI agents and work at a glance.'},
 'ai-access':{title:'AI Access',subtitle:'Choose which AI agents can work on your devices.'},
 sessions:{title:'Sessions',subtitle:'See who is working and when their access ends.'},
 'live-monitor':{title:'Live Monitor',subtitle:'Follow tasks and recent activity across your devices.'},
 devices:{title:'Devices',subtitle:'The computers linked to your Light Remote account.'},
 'long-memory':{title:'Long Memory',subtitle:'Keep project context ready for your next session.'},
 'codex-bridge':{title:'Codex Bridge',subtitle:'Connect Codex and manage the work you choose to delegate.'},
 account:{title:'Account',subtitle:'Your profile, plan and monthly usage.'},
 settings:{title:'Settings',subtitle:'Make Light Remote work the way you want.'}
};
export function WorkspaceShell({route,navigate,status,wallProbe,preview=false,accountEmail,canOpenWall=false,onOpenWall,onRefresh,onSignOut,onLinkDevice,children}:{
 route:RouteKey;navigate:(route:RouteKey)=>void;status:WorkspaceStatus;wallProbe:NativeWallProbe;preview?:boolean;accountEmail?:string|null;
 canOpenWall?:boolean;onOpenWall:()=>void;onRefresh:()=>void;onSignOut:()=>void;onLinkDevice?:()=>void;children:ReactNode;
}){
 const device=status.result?.state==='ready'?status.result.device:null;
 const connected=device?.connection==='connected';
 const connection=status.phase==='loading'?'Checking connection…':device?connected?'Connected':device.connection==='disconnected'?'Disconnected':'Connecting…':wallProbe==='owner_login_required'?'Sign in to Wall':wallProbe==='responding_unverified'?'Check device connection':'Connection unavailable';
 const info=screenTitles[route];
 return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>Skip to content</a>
  <aside className="sidebar"><div className="brand"><img className="brand-symbol" src="./brand-mark.svg" width={36} height={36} alt=""/><div><div className="brand-name">Light Remote</div><div className="brand-subtitle">YOUR AI WORKSPACE</div></div></div>
   <div className="nav-label">Workspace</div><nav className="nav-list" aria-label="Main navigation">{navRoutes.map(item=>{const Icon=icons[item.icon];return <a key={item.key} href={routeHref(item.key)} className={'nav-item'+(route===item.key?' active':'')} aria-current={route===item.key?'page':undefined} onClick={e=>{e.preventDefault();navigate(item.key);}}><Icon size={19} className="nav-icon" aria-hidden="true"/><span>{item.label}</span></a>;})}</nav>
   <div className="side-footer"><span className="eyebrow">This PC</span><strong>{device?.deviceName||'Local device'}</strong><span className="verification-line" role="status"><span className={'status-dot'+(connected?' status-connected':device?.connection==='disconnected'?' status-disconnected':'')} aria-hidden="true"/>{connection}</span></div>
  </aside>
  <main className="main-area" id="main-content" tabIndex={-1}><header className="page-header"><div className="header-copy"><h1>{info.title}</h1><p>{info.subtitle}</p></div><div className="header-actions">
   {preview?<><span className="preview-pill">DESIGN PREVIEW · NOT SIGNED IN</span><Button className="auth-exit-preview" onClick={onSignOut}>Exit UI preview</Button></>:<StatusBadge value={connected?'connected':device?'disconnected':'unknown'} label={connected?'Connected':device?'Disconnected':'Check connection'}/>}
   <Button variant="secondary" className="open-wall-button" disabled={!canOpenWall} onClick={onOpenWall} aria-label="Open Wall" title="Open this PC’s Wall in your browser"><ExternalLink size={16} aria-hidden="true"/><span className="open-wall-label">Open Wall</span></Button>
   <Button variant="ghost" size="icon" aria-label="Refresh" title="Refresh" disabled={status.phase==='loading'} onClick={onRefresh}><RefreshCcw size={17} aria-hidden="true"/></Button>
   <details className="account-menu"><summary aria-label="Account menu"><span className="account-avatar">{accountEmail?.[0]?.toUpperCase()||<UserRound size={17} aria-hidden="true"/>}</span><ChevronDown size={13} aria-hidden="true"/></summary><div className="account-menu-panel"><span className="menu-account">{accountEmail||'Light Remote account'}</span><button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate('account');}}>Account</button><button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate('settings');}}>Settings</button>{onLinkDevice&&<button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');onLinkDevice();}}>Link / Relink this PC</button>}{!preview&&<button onClick={onSignOut}>Sign out</button>}</div></details>
  </div></header>{children}<footer className="page-footer">{preview?'UI preview · no account access or device actions':'Light Remote Desktop'}</footer></main>
 </div>;
}
