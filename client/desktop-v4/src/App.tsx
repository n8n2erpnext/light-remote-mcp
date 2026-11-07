import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, Bell, Database, House, Monitor, RefreshCcw,
  Settings, Shield, Terminal, UserRound, Users, CircleHelp,
  ShieldAlert, ExternalLink, ScrollText, type LucideIcon
} from 'lucide-react';
import { FeatureScreen } from './FeatureScreens';
import {DeviceLinkDialog,nativeLinkAvailable,pollNativeLinkIntent} from './DeviceLinkDialog';
import { Button } from './components/ui/button';
import { Card, CardHeading } from './components/ui/card';
import { navRoutes, parseRoute, routeHref, type RouteKey } from './lib/routes';
import { readLocalWallStatus, type SnapshotResult } from './lib/status';
import { readLocalLogState, type LocalLogResult } from './lib/local-logs';
import { nativeOpenWallAvailable, openLocalWall, type WallView } from './lib/open-wall';
import { probeNativeLocalWall, type NativeWallProbe } from './lib/native-wall-probe';
import { AuthEntry } from './AuthEntry';
import { nativeOwnerAvailable, nativeOwnerBegin, nativeOwnerStatus,
  nativeOwnerRestore, nativeOwnerLogout, type NativeOwnerView } from './lib/native-owner';
import {nativeWallSsoCandidateAvailable,nativeApproveWallCode} from './lib/native-wall-sso';
import {nativeAbv2Available,nativeAbv2Pending,nativeAbv2Approve,
  type NativeAbv2Status,type NativeAbv2Request} from './lib/native-abv2';
import {nativeOwnerSnapshotAvailable,nativeOwnerSnapshot,
  type OwnerSnapshot,type SnapshotView} from './lib/native-snapshot';
import {startScopedReadPoller,type ScopedReadPoller} from './lib/scoped-read-poller';
import {useOwnerInventory} from './lib/use-owner-inventory';
import type {OwnerGrant} from './lib/native-snapshot';

const iconMap: Record<(typeof navRoutes)[number]['icon'], LucideIcon> = {
  house: House,
  shield: Shield,
  users: Users,
  activity: Activity,
  monitor: Monitor,
  database: Database,
  terminal: Terminal,
  user: UserRound,
  settings: Settings
};

// This switch is compiled only into the UNSIGNED UI acceptance pilot and tests.
 // A production build without this flag has NO preview entry and remains gated
 // until real OAuth/Owner session support is implemented.
const UI_DESIGN_PREVIEW = import.meta.env.MODE === 'test' || import.meta.env.VITE_LR_V4_UI_TEST === '1';
const NATIVE_OWNER_CANDIDATE = import.meta.env.VITE_LR_V4_OWNER_LOGIN === '1' && !UI_DESIGN_PREVIEW;

type ThemePreference = 'light' | 'dark' | 'system';
type LoadState = { phase: 'loading' | 'settled'; result: SnapshotResult | null };

function initialTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem('lr-v4-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch { /* storage unavailable is not an error */ }
  return 'system';
}

function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function apply() {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
    }
    apply();
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [theme]);
  const choose = useCallback((mode: ThemePreference) => {
    setTheme(mode);
    try { window.localStorage.setItem('lr-v4-theme', mode); } catch { /* ignore */ }
  }, []);
  return { theme, choose };
}

function StatusLine({ status, wallProbe }: { status: LoadState; wallProbe: NativeWallProbe }) {
  if (status.phase === 'loading') {
    return <span className="verification-line" role="status">Checking Local Wall…</span>;
  }
  if (status.result?.state === 'ready') {
    const state = status.result.device.connection;
    return (
      <span className="verification-line" role="status">
        <span className={'status-dot status-' + state} aria-hidden="true" />
        {state === 'connected' ? 'Connected · verified Local Wall'
          : state === 'disconnected' ? 'Disconnected · verified Local Wall'
          : 'Local Wall responded · connection unverified'}
      </span>
    );
  }
  return <span className="verification-line" role="status">
    <span className="status-dot" aria-hidden="true" />
    {wallProbe === 'owner_login_required' ? 'Wall reachable · Owner login required'
      : wallProbe === 'responding_unverified' ? 'Wall responding · state unverified'
      : 'Device state not verified'}
  </span>;
}

function Sidebar({ active, navigate, status, wallProbe }: {
  active: RouteKey;
  navigate: (route: RouteKey) => void;
  status: LoadState;
  wallProbe: NativeWallProbe;
}) {
  const deviceName = status.result?.state === 'ready'
    ? status.result.device.deviceName
    : null;
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-symbol" src="./brand-mark.svg" width={40} height={40} alt="" />
        <div><div className="brand-name">Light Remote</div><div className="brand-subtitle">AI OPERATOR</div></div>
      </div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="nav-list" aria-label="Main navigation">
        {navRoutes.map(item => {
          const Icon = iconMap[item.icon];
          return (
            <a
              href={routeHref(item.key)}
              key={item.key}
              className={'nav-item' + (active === item.key ? ' active' : '')}
              aria-current={active === item.key ? 'page' : undefined}
              onClick={() => navigate(item.key)}
            >
              <Icon className="nav-icon" size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>
      <div className="side-footer" aria-live="polite">
        <span className="eyebrow">LOCAL DEVICE</span>
        <strong>{deviceName || 'Device not verified'}</strong>
        <StatusLine status={status} wallProbe={wallProbe} />
      </div>
    </aside>
  );
}

function DataBoundaryNotice({ status }: { status: LoadState }) {
  return (
    <div className="data-boundary">
      <div className="data-boundary-title"><ShieldAlert size={17} aria-hidden="true" /> VERIFIED DATA ONLY</div>
      <span>{status.result?.state === 'ready'
        ? 'Only the read-only Local Wall device snapshot is bound. Owner grants and quotas require separate signed APIs.'
        : 'Local Wall data is unavailable or unauthenticated. No device, session, grant or usage values have been inferred.'}</span>
    </div>
  );
}

export function NativeApprovalRequest({
  request,consentRequired,approving,onApprove
}:{
  request:NativeAbv2Request;
  consentRequired:boolean;
  approving:boolean;
  onApprove:(request:NativeAbv2Request,bCode:string,consentCode:string)=>Promise<boolean>;
}) {
  const [bCode,setBCode]=useState('');
  const [consentCode,setConsentCode]=useState('');
  const [result,setResult]=useState<'idle'|'approved'|'failed'>('idle');
  const validB=/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(bCode);
  const validConsent=!consentRequired||/^[A-Za-z0-9_-]{32}$/.test(consentCode);
  const submit=async(e:React.FormEvent)=>{
    e.preventDefault();
    if(!validB||!validConsent||approving)return;
    const ok=await onApprove(request,bCode,consentCode);
    setBCode('');setConsentCode('');
    setResult(ok?'approved':'failed');
  };
  return <form className="approval-surface" onSubmit={submit}>
    <p><strong>Agent connection request</strong> · Attempt {request.attempt}</p>
    <p className="field-note">A code: {request.aCode||'Verified by enrolled Agent'} · Expires {new Date(request.expiresAt).toLocaleTimeString()}</p>
    <label className="eyebrow" htmlFor={'b-code-'+request.requestId}>B code from AI Agent</label>
    <input id={'b-code-'+request.requestId} type="text" value={bCode}
      maxLength={9} autoComplete="off" spellCheck={false}
      placeholder="XXXX-XXXX" aria-label="Agent B code"
      onChange={e=>{setResult('idle');setBCode(e.target.value.toUpperCase());}} />
    {consentRequired&&<>
      <label className="eyebrow" htmlFor={'consent-'+request.requestId}>Owner consent code</label>
      <input id={'consent-'+request.requestId} type="text" value={consentCode}
        maxLength={32} autoComplete="off" spellCheck={false}
        placeholder="Required Owner consent" onChange={e=>setConsentCode(e.target.value)} />
    </>}
    <Button variant="primary" type="submit" disabled={!validB||!validConsent||approving}>
      {approving?'Approving…':'Approve Agent'}
    </Button>
    {result==='approved'&&<p role="status">Approved by the enrolled Agent and Operator.</p>}
    {result==='failed'&&<p role="alert">Approval unavailable or expired. Refresh the request and try again.</p>}
  </form>;
}

function PendingApprovals({native,refresh,approving,onApprove}:{
  native:NativeAbv2Status|null;
  refresh:()=>void;
  approving:boolean;
  onApprove:(request:NativeAbv2Request,bCode:string,consentCode:string)=>Promise<boolean>;
}) {
  if (native) {
    return <Card className="approval-card">
      <CardHeading description="Live same-device Agent · current Owner session">PENDING APPROVALS</CardHeading>
      {native.state==='ready'?<>
        <div className="approval-surface">
          <h3>{native.pending.length===0?'No pending A/B V2 requests':native.pending.length+' verified request(s)'}</h3>
          <p>Device: {native.shortId||native.deviceId}. Approvals require the B code and current Owner authority.</p>
          <Button variant="secondary" onClick={refresh}>Refresh pending requests</Button>
          {!native.ownerApproveEnabled&&<p role="alert">Agent approvals are disabled by the backend policy.</p>}
        </div>
        {native.ownerApproveEnabled&&native.pending.map(request=>
          <NativeApprovalRequest key={request.requestId} request={request}
            consentRequired={native.ownerConsentRequired}
            approving={approving} onApprove={onApprove} />)}
      </>:<div className="approval-surface">
        <h3>Local GoldABV2 Agent not available</h3>
        <p>Owner is logged in, but the same-device enrolled Agent has not exposed its A/B V2 native channel. This application will not use another machine's Wall or the older Gold client.</p>
        <Button variant="secondary" onClick={refresh}>Retry Agent connection</Button>
      </div>}
    </Card>;
  }
  return (
    <Card className="approval-card">
      <CardHeading description="Owner-verified A/B V2 requests">PENDING APPROVALS</CardHeading>
      <div className="approval-surface">
        <h3>Approval requests not verified</h3>
        <p>The Owner request list is unavailable until signed Agent discovery and authorization are verified.</p>
        <div className="approval-state">
          <span className="eyebrow">STANDBY · DEVICE SHORT ID</span>
          <strong>—</strong>
        </div>
        <Button variant="secondary" disabled title="Owner-scoped approval API is not wired; no safe grant action is available">
          Review owner requests
        </Button>
        <p className="field-note">A code: 6-character Short ID + 5 rotating characters · expires in 5 minutes.</p>
      </div>
    </Card>
  );
}

function AuthorizationPolicy({native}:{native:NativeAbv2Status|null}) {
  return (
    <Card className="policy-card">
      <CardHeading description="Backend is the only source of grants">AUTHORIZATION POLICY</CardHeading>
      <div className="policy-surface">
        <p>B code: 4 + 4 · Owner consent</p>
        <p>Grant: 24 hours per Agent</p>
        <p className="caution"><span className="caution-dot" />{native?.state==='ready'
          ?native.ownerApproveEnabled?'Signed Owner/Agent approval is available':'Operator has disabled A/B approval'
          :'A/B V2 capability not verified — approval unavailable'}</p>
      </div>
    </Card>
  );
}

function ActiveGrants({snapshot,ownerAccountId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null}) {
  const needsPages=!snapshot||snapshot.coverage?.grants?.hasMore===true;
  const inventory=useOwnerInventory('grants',needsPages?ownerAccountId:null);
  const paged=needsPages&&inventory.pages.length>0;
  const partial=Boolean(snapshot?.coverage?.grants?.hasMore);
  const rows:ReadonlyArray<OwnerGrant>=paged?inventory.rows.filter(
    (row):row is OwnerGrant=>'grantId' in row):snapshot?.grants||[];
  const verified=Boolean(snapshot)||paged;
  return <Card className="grants-card">
    <CardHeading description="Verified Owner and Operator per-Agent registry">ACTIVE AGENT GRANTS</CardHeading>
    {verified?<div className="feature-table feature-table-scroll" role="region" aria-label="Active Agent Grants">
      <table><thead><tr><th>Agent</th><th>Device</th><th>Approved</th><th>Expires</th></tr></thead>
        <tbody>{rows.length?rows.map(g=><tr key={g.grantId}>
          <td>{g.agentId||g.grantId}</td>
          <td>{snapshot?.devices.find(d=>d.deviceId===g.deviceId)?.name||g.deviceId}</td>
          <td>{g.approvedAt===null?'—':new Date(g.approvedAt).toLocaleString()}</td>
          <td>{g.expiresAt===null?'—':new Date(g.expiresAt).toLocaleString()}</td>
        </tr>):<tr><td colSpan={4}>No active grants in verified Owner registry</td></tr>}</tbody>
      </table></div>:<div className="grants-surface">
      <h3>No verified grants</h3>
      <p>Owner-scoped grant API is disabled or could not be verified. No grants are inferred.</p>
    </div>}
    {partial&&!paged&&<div className="feature-filterbar" role="status">
      <span>Showing {snapshot!.grants.length} of {snapshot!.coverage!.grants!.total} verified active grants. Loading paged Owner grant view.</span>
    </div>}
    {paged&&<div className="feature-filterbar" role="status">
      <span>Showing {inventory.loaded} of {inventory.total} verified Owner device grants. Older pages may become stale after revocation.</span>
      {inventory.hasMore&&<Button disabled={inventory.pending} onClick={()=>void inventory.loadMore()}>
        {inventory.pending?'Loading…':'Load more grants'}</Button>}
    </div>}
    {!snapshot&&inventory.error&&<p role="alert">{inventory.error}</p>}
    <p className="muted">Per-Agent revoke and renewal require a separately authorized mutation API.</p>
  </Card>;
}
function AiAccess({ status,native,refresh,approving,onApprove,snapshot,ownerAccountId }: {
  status:LoadState;
  native:NativeAbv2Status|null;
  snapshot:OwnerSnapshot|null;
  ownerAccountId:string|null;
  refresh:()=>void;
  approving:boolean;
  onApprove:(request:NativeAbv2Request,bCode:string,consentCode:string)=>Promise<boolean>;
}) {
  return (
    <div className="screen-content">
      <div className="approval-grid">
        <PendingApprovals native={native} refresh={refresh} approving={approving} onApprove={onApprove} />
        <AuthorizationPolicy native={native} />
      </div>
      <ActiveGrants snapshot={snapshot} ownerAccountId={ownerAccountId} />
      <DataBoundaryNotice status={status} />
    </div>
  );
}

function Overview({ status, navigate, wallProbe, abv2, snapshot }: {
  status: LoadState;
  navigate: (route: RouteKey) => void;
  wallProbe: NativeWallProbe;
  abv2: NativeAbv2Status|null;
  snapshot: OwnerSnapshot|null;
}) {
  const verified = status.result?.state === 'ready' ? status.result.device : null;
  return (
    <div className="screen-content">
      <div className="overview-grid">
        <Card className="metric-card">
          <CardHeading>LOCAL DEVICE</CardHeading>
          <strong className="metric-value metric-text">{verified?.deviceName || '—'}</strong>
          <span className="muted">{verified ? 'Response verified from this Local Wall'
            : wallProbe === 'owner_login_required' ? 'Wall responding · Owner login required'
              : wallProbe === 'responding_unverified' ? 'Wall responding · device unverified'
                : 'Not verified'}</span>
        </Card>
        <Card className="metric-card">
          <CardHeading>AI SESSIONS</CardHeading>
          <strong className="metric-value">{snapshot?(snapshot.coverage?.sessions
            ?snapshot.coverage.sessions.activeTotal+snapshot.coverage.sessions.holdTotal
            :snapshot.sessions.filter(s=>s.state==='active'||s.state==='hold').length):'—'}</strong>
          <span className="muted">{snapshot?'Verified Owner session registry':'Authenticated session list unavailable'}</span>
        </Card>
        <Card className="metric-card">
          <CardHeading>PENDING APPROVALS</CardHeading>
          <strong className="metric-value">{abv2?.state==='ready'?abv2.pending.length:'—'}</strong>
          <span className="muted">{abv2?.state==='ready'?'Verified by local enrolled Agent':'Owner and Agent verification required'}</span>
        </Card>
      </div>
      <div className="overview-main">
        <Card>
          <CardHeading description="Owner approval · A/B V2">AI ACCESS</CardHeading>
          <div className="inset">
            <h3>Waiting for a signed request</h3>
            <p>B code and Owner consent required. Short ID alone never authorizes an Agent.</p>
            <Button onClick={() => navigate('ai-access')} variant="primary">View AI Access</Button>
          </div>
        </Card>
        <Card>
          <CardHeading description="Signed leases and verified terminal states">AGENT SESSIONS</CardHeading>
          <div className="inset"><h3>{snapshot?(snapshot.coverage?.sessions?.hasMore
            ?`Showing ${snapshot.coverage.sessions.returned} of ${snapshot.coverage.sessions.total} verified session(s)`
            :`${snapshot.sessions.length} verified session(s)`):'No verified sessions to display'}</h3><p>{snapshot?'View Owner session registry for per-Agent state.':'Sessions appear after Owner approval.'}</p><Button variant="secondary" onClick={()=>navigate('sessions')}>View Sessions</Button></div>
        </Card>
        <Card>
          <CardHeading description="Jobs · output · execution evidence">LIVE MONITOR</CardHeading>
          <div className="inset"><h3>Waiting for verified Agent events</h3><p>No synthetic job activity is displayed.</p></div>
        </Card>
        <Card>
          <CardHeading description="Agent · Local Wall · Updates">DEVICE HEALTH</CardHeading>
          <div className="inset">
            <h3>{verified?.connection === 'connected' ? 'Connected'
              : verified?.connection === 'disconnected' ? 'Disconnected'
                : 'Unknown until verified'}</h3>
            <p>{verified?.cloudState ? 'Reported Agent state: ' + verified.cloudState : 'Read-only preview · no simulated telemetry'}</p>
          </div>
        </Card>
      </div>
      <DataBoundaryNotice status={status} />
    </div>
  );
}

function SettingsPage({ theme, choose, status, openWall, canOpenWall }: {
  theme: ThemePreference;
  choose: (theme: ThemePreference) => void;
  status: LoadState;
  openWall: (view: WallView) => void;
  canOpenWall: boolean;
}) {
  const [logs, setLogs] = useState<LocalLogResult>({ state: 'unavailable', reason: 'not_checked' });
  const [refreshLog, setRefreshLog] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readLocalLogState(fetch, controller.signal).then(data => {
      if (!controller.signal.aborted) setLogs(data);
    });
    return () => controller.abort();
  }, [refreshLog]);
  const toMiB = (bytes: number) => (bytes / 1048576).toFixed(1) + ' MiB';
  return (
    <div className="screen-content settings-layout">
      <Card>
        <CardHeading description="Appearance, local policy and owner-gated actions">SETTINGS GROUPS</CardHeading>
        <div className="settings-menu">
          <strong>Appearance</strong><span>Privacy &amp; Security</span><span>Filesystem Roots</span>
          <span>Desktop Permissions</span><span>Startup / Notifications</span><span>Agent / Updates</span>
          <span>Activity Logs</span>
        </div>
      </Card>
      <div className="settings-column">
        <Card>
          <CardHeading description="Theme changes do not change Agent permissions">APPEARANCE</CardHeading>
          <fieldset className="theme-fieldset">
            <legend>Color Mode</legend>
            {(['light', 'dark', 'system'] as const).map(option =>
              <label className="theme-choice" key={option}>
                <input type="radio" name="theme" value={option}
                  checked={theme === option} onChange={() => choose(option)} />
                {option === 'system' ? 'Use system setting' : option === 'light' ? 'Light' : 'Dark'}
              </label>
            )}
          </fieldset>
        </Card>
        <Card>
          <CardHeading description="Capabilities are checked by the authorized native host">
            DEVICE &amp; OS PERMISSIONS
          </CardHeading>
          <p className="muted">Allowed filesystem roots require Admin approval. OS accessibility and screen recording permissions are separate platform gates.</p>
          <p className="muted">Denied / unsupported / Owner required are distinct states.</p>
        </Card>
        <Card className="activity-logs-card">
          <CardHeading description="Device-local working history · bounded RAM and mandatory disk rotation">ACTIVITY LOGS</CardHeading>
          {logs.state === 'ready' ? (
            <div className="log-summary" role="status">
              <span>Retention</span><strong>{logs.log.preset.charAt(0).toUpperCase() + logs.log.preset.slice(1)}</strong>
              <span>Disk usage</span><strong>{toMiB(logs.log.usedBytes)} / {toMiB(logs.log.maxDiskBytes)}</strong>
              <span>Recent RAM events</span><strong>{logs.log.ramEvents}</strong>
              {logs.log.lastError && <p className="log-warning">{logs.log.lastError}</p>}
            </div>
          ) : (
            <div className="inset log-unverified" role="status">
              <ScrollText size={23} aria-hidden="true" />
              <div><h3>Activity logs live on this device</h3>
                <p>Log usage cannot be read without an authenticated, same-origin Local Wall session.
                  Open Wall to view history, configure rotation or clean local logs.</p>
              </div>
            </div>
          )}
          <div className="log-actions">
            <Button variant="primary" disabled={!canOpenWall} onClick={() => openWall('logs')}>
              <ExternalLink size={16} aria-hidden="true" /> Open Activity Logs in Wall
            </Button>
            <Button variant="secondary" onClick={() => setRefreshLog(x => x + 1)}>Refresh log status</Button>
          </div>
          <p className="muted log-footnote">RAM: 8 MiB / 5,000 events / 60 minutes.
            Disk: Compact 48 MiB · Standard 200 MiB (default) · Extended 300 MiB.
            All presets rotate automatically. Clean Log requires authenticated Owner confirmation in Wall.</p>
          {!canOpenWall && <p className="muted">Open Wall is available in the native Desktop app; no local browser launch is performed from this web preview.</p>}
        </Card>
        <DataBoundaryNotice status={status} />
      </div>
    </div>
  );
}

const titles: Record<RouteKey, { title: string; subtitle: string }> = {
  overview: { title: 'Overview', subtitle: 'Desktop & Local Wall · authenticated device control' },
  'ai-access': { title: 'AI Access', subtitle: 'Owner authorization, pending requests and per-Agent grants' },
  sessions: { title: 'AI Sessions', subtitle: 'Verified session state and lease countdown' },
  'live-monitor': { title: 'Live Monitor', subtitle: 'Read-only Agent activity, job lifecycle and execution receipts' },
  devices: { title: 'Devices', subtitle: 'Enrollment, identity preservation and device status' },
  'long-memory': { title: 'Long Memory', subtitle: 'Project Memory · Home and selected replica devices' },
  'codex-bridge': { title: 'Codex Bridge', subtitle: 'Optional local observer and task history' },
  account: { title: 'Account', subtitle: 'Owner identity, plan and usage — verified sources only' },
  settings: { title: 'Settings & Permissions', subtitle: 'Appearance, local policy, OS permissions and guarded actions' }
};

export function App() {
  const [route, setRoute] = useState<RouteKey>(() => parseRoute(window.location.hash));
  const [showDeviceLink,setShowDeviceLink]=useState(false);
  const closeDeviceLink=useCallback(()=>setShowDeviceLink(false),[]);
  useEffect(()=>{
    if(!nativeLinkAvailable())return;
    let live=true;
    const id=window.setInterval(()=>{
      void pollNativeLinkIntent().then(requested=>{if(live&&requested)setShowDeviceLink(true);});
    },850);
    return()=>{live=false;window.clearInterval(id);};
  },[]);
  const [inDesignPreview, setInDesignPreview] = useState(false);
  const [nativeOwner, setNativeOwner] = useState<NativeOwnerView>({phase:'unavailable',accountId:null});
  const { theme, choose } = useTheme();
  const nativeLoginAvailable = NATIVE_OWNER_CANDIDATE && nativeOwnerAvailable();
  const nativeOwnerVerified = nativeLoginAvailable && nativeOwner.phase === 'verified';
  const nativeAbv2Pilot=!UI_DESIGN_PREVIEW&&nativeOwnerVerified&&nativeAbv2Available();
  const [abv2,setAbv2]=useState<NativeAbv2Status>({state:'unavailable',reason:'not_checked'});
  const [ownerData,setOwnerData]=useState<SnapshotView>({state:'unavailable',reason:'not_checked'});
  const snapshot=ownerData.state==='ready' && nativeOwnerVerified &&
    ownerData.accountId===nativeOwner.accountId?ownerData:null;
  useEffect(()=>{
    if(!nativeOwnerVerified||!nativeOwner.accountId||!nativeOwnerSnapshotAvailable()){
      setOwnerData({state:'unavailable',reason:'owner_api_unavailable'});
      return;
    }
    const accountId=nativeOwner.accountId;
    setOwnerData({state:'unavailable',reason:'owner_snapshot_refreshing'});
    const poller=startScopedReadPoller({
      intervalMs:20_000,
      task:()=>nativeOwnerSnapshot(accountId),
      apply:setOwnerData,
      healthy:(view)=>view.state==='ready',
      unavailable:():SnapshotView=>({state:'unavailable',reason:'owner_api_unavailable'})
    });
    return ()=>poller.stop();
  },[nativeOwnerVerified,nativeOwner.accountId]);
  const [abv2Approving,setAbv2Approving]=useState(false);
  const abv2Poller=useRef<ScopedReadPoller|null>(null);
  const refreshAbv2=useCallback(()=>{
    if(nativeAbv2Pilot)abv2Poller.current?.refreshNow();
  },[nativeAbv2Pilot]);
  const approveAbv2=async(request:NativeAbv2Request,bCode:string,consentCode:string)=>{
    if(!nativeAbv2Pilot||abv2Approving)return false;
    setAbv2Approving(true);
    try{
      const result=await nativeAbv2Approve(request,bCode,consentCode);
      if(result.state==='granted')refreshAbv2();
      return result.state==='granted';
    }finally{setAbv2Approving(false);}
  };
  useEffect(()=>{
    if(!nativeAbv2Pilot){
      setAbv2({state:'unavailable',reason:'owner_not_verified'});
      return;
    }
    const poller=startScopedReadPoller({
      intervalMs:8000,
      task:nativeAbv2Pending,
      apply:setAbv2,
      healthy:(view)=>view.state==='ready',
      unavailable:():NativeAbv2Status=>({state:'unavailable',reason:'agent_or_owner_unavailable'})
    });
    abv2Poller.current=poller;
    return ()=>{
      if(abv2Poller.current===poller)abv2Poller.current=null;
      poller.stop();
    };
  },[nativeAbv2Pilot]);

  const nativeWallSsoPilot = !UI_DESIGN_PREVIEW && nativeWallSsoCandidateAvailable();
  const [wallSsoCode,setWallSsoCode]=useState('');
  const [wallSsoBusy,setWallSsoBusy]=useState(false);
  const [wallSsoResult,setWallSsoResult]=useState<string|null>(null);
  const approveBrowserWallCode=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(!nativeOwnerVerified||!nativeWallSsoPilot||wallSsoBusy)return;
    setWallSsoBusy(true);setWallSsoResult(null);
    const approved=await nativeApproveWallCode(wallSsoCode);
    setWallSsoBusy(false);setWallSsoCode('');
    setWallSsoResult(approved
      ?'Owner confirmed. Return to the same browser tab to finish signing in.'
      :'Unable to verify this code. Check the Wall request and your Owner session.');
  };
  const workspaceUnlocked = inDesignPreview || nativeOwnerVerified;
  const [status, setStatus] = useState<LoadState>({ phase: 'loading', result: null });
  const [reload, setReload] = useState(0);
  const [wallProbe, setWallProbe] = useState<NativeWallProbe>('unavailable');
  const [wallOpenError, setWallOpenError] = useState<string | null>(null);
  const canOpenWall = nativeOpenWallAvailable();
  const requestOpenWall = useCallback((view: WallView) => {
    setWallOpenError(null);
    void openLocalWall(view).then(result => {
      if (result.state === 'unavailable') setWallOpenError('Could not launch the system browser. Check that the default browser is available.');
    });
  }, []);

  // Native Rust owns PKCE, the vault and server verification; never JS tokens.
  useEffect(() => {
    if (!nativeLoginAvailable) return;
    let alive=true;
    let sequence=0;
    const apply=(view:NativeOwnerView,rev:number)=>{
      if(alive && rev===sequence)setNativeOwner(view);
    };
    const poll=()=>{
      const rev=++sequence;
      void nativeOwnerStatus().then(view=>apply(view,rev));
    };
    const rev=++sequence;
    void nativeOwnerRestore().then(view=>apply(view,rev));
    const timer=window.setInterval(poll,3_000);
    const onVisible=()=>{if(!document.hidden)poll();};
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{
      alive=false;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisible);
    };
  },[nativeLoginAvailable]);

  const beginNativeOwner=()=>{
    if(nativeLoginAvailable)void nativeOwnerBegin().then(setNativeOwner);
  };
  const cancelNativeOwner=()=>{
    if(nativeLoginAvailable)void nativeOwnerLogout().then(setNativeOwner);
  };

  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    if (!workspaceUnlocked) {
      setStatus({ phase: 'settled', result: null });
      return;
    }
    const controller = new AbortController();
    let live = true;
    setStatus({ phase: 'loading', result: null });
    void readLocalWallStatus(fetch, controller.signal).then(result => {
      if (live) setStatus({ phase: 'settled', result });
    });
    return () => { live = false; controller.abort(); };
  }, [reload, workspaceUnlocked]);

  useEffect(() => {
    if (!workspaceUnlocked || !nativeOpenWallAvailable()) return;
    let live = true;
    setWallProbe('unavailable');
    void probeNativeLocalWall().then(result => { if (live) setWallProbe(result); });
    return () => { live = false; };
  }, [reload, workspaceUnlocked]);

  // A previously verified connection must not remain shown forever.
  // Poll read-only status while visible and revalidate immediately after returning.
  useEffect(() => {
    if (!workspaceUnlocked) return;
    const refreshVisible = () => {
      if (!document.hidden) setReload(value => value + 1);
    };
    const timer = window.setInterval(refreshVisible, 15_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [workspaceUnlocked]);

  const navigate = (next: RouteKey) => {
    setRoute(next);
    if (window.location.hash !== routeHref(next)) window.location.hash = routeHref(next);
  };
  const info = titles[route];

  // Enforce authentication as the ENTRY route. Neither location.hash nor
  // native localhost probe can skip this gate. Only explicit UI-test builds
  // expose a non-authoritative preview; no credential is persisted.
  if (!workspaceUnlocked) {
    // Enrollment is a local physical-device action, not an Agent grant.
    // The Owner has to be able to open the Tray Link dialog even BEFORE
    // Desktop OAuth login; no JS bearer or saved login is accessed here.
    return <>
      <AuthEntry
        allowDesignPreview={UI_DESIGN_PREVIEW}
        onPreviewWorkspace={() => { if (UI_DESIGN_PREVIEW) setInDesignPreview(true); }}
        nativePhase={nativeLoginAvailable ? nativeOwner.phase : undefined}
        onBrowserSignIn={nativeLoginAvailable ? beginNativeOwner : undefined}
        onCancelSignIn={nativeLoginAvailable ? cancelNativeOwner : undefined} />
      {nativeLinkAvailable()&&<Button type="button" variant="secondary"
        onClick={()=>setShowDeviceLink(true)}>Link / Relink this device</Button>}
      {showDeviceLink&&nativeLinkAvailable()&&<DeviceLinkDialog onClose={closeDeviceLink}/>}
    </>;
  }

  return (
    <div className="app-shell">
      <Sidebar active={route} navigate={navigate} status={status} wallProbe={wallProbe} />
      <main className="main-area" id="main-content">
        <header className="page-header">
          <div className="header-copy">
            <h1>{info.title}</h1>
            <p>{info.subtitle}</p>
          </div>
          <div className="header-actions">
            <Button variant="secondary" className="auth-exit-preview"
              onClick={inDesignPreview ? () => setInDesignPreview(false) : cancelNativeOwner}>
              {inDesignPreview ? 'Exit UI preview' : 'Sign out'}
            </Button>
            {nativeLinkAvailable()&&<Button type="button" variant="secondary"
              onClick={()=>setShowDeviceLink(true)}>Link / Relink</Button>}
            <Button variant="secondary" className="open-wall-button" disabled={!canOpenWall}
              title={canOpenWall ? 'Open this device Local Wall in the default browser' : 'Available only inside the native Desktop app'}
              onClick={() => requestOpenWall('home')} aria-label="Open Wall">
              <ExternalLink size={16} aria-hidden="true" /> <span className="open-wall-label">Open Wall</span>
            </Button>
            <Bell size={19} aria-hidden="true" className="header-symbol" />
            <Button variant="ghost" size="icon" aria-label="Open Settings" onClick={() => navigate('settings')}>
              <Settings size={19} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Refresh verified Local Wall status"
              title="Refresh read-only Local Wall device state"
              onClick={() => setReload(i => i + 1)} disabled={status.phase === 'loading'}>
              <RefreshCcw size={18} aria-hidden="true" />
            </Button>
            <span className="preview-pill"><span className="status-dot" aria-hidden="true" />{inDesignPreview ? 'DESIGN PREVIEW · NOT SIGNED IN' : 'OWNER VERIFIED · WALL UNVERIFIED'}</span>
          </div>
        </header>
        {wallOpenError && <div className="open-wall-error" role="alert">{wallOpenError}</div>}
        {nativeWallSsoPilot && nativeOwnerVerified && route==='overview' && !inDesignPreview && (
          <section className="owner-wall-sso-review" aria-labelledby="owner-wall-sso-title">
            <h2 id="owner-wall-sso-title">Sign in to Local Wall</h2>
            <p>On this device, open Wall and select <strong>Sign in with Desktop V4</strong>. Generate a verification code in that browser tab, then enter it here. This never approves Agent A/B access.</p>
            <form onSubmit={approveBrowserWallCode}>
              <label htmlFor="owner-wall-sso-code">Wall verification code</label>
              <input id="owner-wall-sso-code" value={wallSsoCode}
                maxLength={8} autoComplete="off" autoCapitalize="none" spellCheck={false}
                onChange={event=>{setWallSsoCode(event.target.value);setWallSsoResult(null);}}
                aria-describedby="owner-wall-sso-info" />
              <Button type="submit" disabled={wallSsoBusy||!(/^[A-Za-z0-9_-]{8}$/.test(wallSsoCode))}>
                {wallSsoBusy?'Verifying Owner…':'Approve Wall sign-in'}
              </Button>
            </form>
            <p id="owner-wall-sso-info">The code expires after 60 seconds. No token or ticket enters this screen.</p>
            {wallSsoResult && <p role="status">{wallSsoResult}</p>}
          </section>
        )}
        {route === 'overview' ? <Overview status={status} navigate={navigate} wallProbe={wallProbe} abv2={nativeAbv2Pilot?abv2:null} snapshot={snapshot} />
          : route === 'ai-access' ? <AiAccess status={status} native={nativeAbv2Pilot?abv2:null} snapshot={snapshot} ownerAccountId={nativeOwnerVerified?nativeOwner.accountId:null} refresh={refreshAbv2} approving={abv2Approving} onApprove={approveAbv2} />
            : route === 'settings' ? <SettingsPage theme={theme} choose={choose} status={status} openWall={requestOpenWall} canOpenWall={canOpenWall} />
              : <FeatureScreen route={route} status={status.result} snapshot={snapshot} ownerAccountId={nativeOwnerVerified?nativeOwner.accountId:null} />}
        <footer className="page-footer">
          <CircleHelp size={14} aria-hidden="true" />
          {inDesignPreview ? 'Desktop V4 UI preview · not authenticated · no Owner grants or Agent mutations' : 'Desktop Owner verified - Local Wall and Agent A/B authorization remain separate'}
        </footer>
      </main>
      {showDeviceLink&&nativeLinkAvailable()&&<DeviceLinkDialog onClose={closeDeviceLink} />}
    </div>
  );
}
