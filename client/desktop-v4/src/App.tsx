import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, Bell, Database, House, Monitor, RefreshCcw,
  Settings, Shield, Terminal, UserRound, Users, CircleHelp,
  ShieldAlert, ExternalLink, ScrollText, type LucideIcon
} from 'lucide-react';
import { FeatureScreen } from './FeatureScreens';
import { Button } from './components/ui/button';
import { Card, CardHeading } from './components/ui/card';
import { navRoutes, parseRoute, routeHref, type RouteKey } from './lib/routes';
import { readLocalWallStatus, type SnapshotResult } from './lib/status';
import { readLocalLogState, type LocalLogResult } from './lib/local-logs';
import { nativeOpenWallAvailable, openLocalWall, type WallView } from './lib/open-wall';
import { probeNativeLocalWall, type NativeWallProbe } from './lib/native-wall-probe';
import { AuthEntry } from './AuthEntry';

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

function PendingApprovals() {
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

function AuthorizationPolicy() {
  return (
    <Card className="policy-card">
      <CardHeading description="Backend is the only source of grants">AUTHORIZATION POLICY</CardHeading>
      <div className="policy-surface">
        <p>B code: 4 + 4 · Owner consent</p>
        <p>Grant: 24 hours per Agent</p>
        <p className="caution"><span className="caution-dot" />A/B V2 capability not verified — approval unavailable</p>
      </div>
    </Card>
  );
}

function ActiveGrants() {
  return (
    <Card className="grants-card">
      <CardHeading description="Per-Agent lease, nickname and verified revocation state">
        ACTIVE AGENT GRANTS
      </CardHeading>
      <div className="grants-surface">
        <h3>No verified grants</h3>
        <p>Approved Agent sessions will appear only when a signed source returns grants and real expiry times.</p>
        <p>Revocation or renewal requires authenticated Owner authority.</p>
        <span className="status-tag">Awaiting verified Owner API</span>
      </div>
    </Card>
  );
}

function AiAccess({ status }: { status: LoadState }) {
  return (
    <div className="screen-content">
      <div className="approval-grid">
        <PendingApprovals />
        <AuthorizationPolicy />
      </div>
      <ActiveGrants />
      <DataBoundaryNotice status={status} />
    </div>
  );
}

function Overview({ status, navigate, wallProbe }: {
  status: LoadState;
  navigate: (route: RouteKey) => void;
  wallProbe: NativeWallProbe;
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
          <strong className="metric-value">—</strong>
          <span className="muted">Authenticated session list not bound</span>
        </Card>
        <Card className="metric-card">
          <CardHeading>PENDING APPROVALS</CardHeading>
          <strong className="metric-value">—</strong>
          <span className="muted">Owner verification required</span>
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
          <div className="inset"><h3>No verified sessions to display</h3><p>Sessions appear after Owner approval.</p></div>
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
  const [inDesignPreview, setInDesignPreview] = useState(false);
  const { theme, choose } = useTheme();
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

  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    if (!inDesignPreview) {
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
  }, [reload, inDesignPreview]);

  useEffect(() => {
    if (!inDesignPreview || !nativeOpenWallAvailable()) return;
    let live = true;
    setWallProbe('unavailable');
    void probeNativeLocalWall().then(result => { if (live) setWallProbe(result); });
    return () => { live = false; };
  }, [reload, inDesignPreview]);

  // A previously verified connection must not remain shown forever.
  // Poll read-only status while visible and revalidate immediately after returning.
  useEffect(() => {
    if (!inDesignPreview) return;
    const refreshVisible = () => {
      if (!document.hidden) setReload(value => value + 1);
    };
    const timer = window.setInterval(refreshVisible, 15_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [inDesignPreview]);

  const navigate = (next: RouteKey) => {
    setRoute(next);
    if (window.location.hash !== routeHref(next)) window.location.hash = routeHref(next);
  };
  const info = titles[route];

  // Enforce authentication as the ENTRY route. Neither location.hash nor
  // native localhost probe can skip this gate. Only explicit UI-test builds
  // expose a non-authoritative preview; no credential is persisted.
  if (!inDesignPreview) {
    return <AuthEntry
      allowDesignPreview={UI_DESIGN_PREVIEW}
      onPreviewWorkspace={() => { if (UI_DESIGN_PREVIEW) setInDesignPreview(true); }} />;
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
            <Button variant="secondary" className="auth-exit-preview" onClick={() => setInDesignPreview(false)}>
              Exit UI preview
            </Button>
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
            <span className="preview-pill"><span className="status-dot" aria-hidden="true" />DESIGN PREVIEW · NOT SIGNED IN</span>
          </div>
        </header>
        {wallOpenError && <div className="open-wall-error" role="alert">{wallOpenError}</div>}
        {route === 'overview' ? <Overview status={status} navigate={navigate} wallProbe={wallProbe} />
          : route === 'ai-access' ? <AiAccess status={status} />
            : route === 'settings' ? <SettingsPage theme={theme} choose={choose} status={status} openWall={requestOpenWall} canOpenWall={canOpenWall} />
              : <FeatureScreen route={route} status={status.result} />}
        <footer className="page-footer">
          <CircleHelp size={14} aria-hidden="true" />
          Desktop V4 UI preview · not authenticated · no Owner grants or Agent mutations
        </footer>
      </main>
    </div>
  );
}
