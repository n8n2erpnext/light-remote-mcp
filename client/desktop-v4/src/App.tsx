import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity, Bell, Database, House, Monitor, RefreshCcw,
  Settings2, Shield, Terminal, UserRound, Users, CircleHelp,
  CheckCircle2, ShieldAlert, type LucideIcon
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardHeading } from './components/ui/card';
import { navRoutes, parseRoute, routeHref, type RouteKey } from './lib/routes';
import { readLocalWallStatus, type SnapshotResult } from './lib/status';

const iconMap: Record<(typeof navRoutes)[number]['icon'], LucideIcon> = {
  house: House,
  shield: Shield,
  users: Users,
  activity: Activity,
  monitor: Monitor,
  database: Database,
  terminal: Terminal,
  user: UserRound,
  settings: Settings2
};

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

function StatusLine({ status }: { status: LoadState }) {
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
    <span className="status-dot" aria-hidden="true" />Device state not verified
  </span>;
}

function Sidebar({ active, navigate, status }: {
  active: RouteKey;
  navigate: (route: RouteKey) => void;
  status: LoadState;
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
        <StatusLine status={status} />
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
        <h3>No signed requests</h3>
        <p>Requests appear only after signed Agent discovery.</p>
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

function Overview({ status, navigate }: {
  status: LoadState;
  navigate: (route: RouteKey) => void;
}) {
  const verified = status.result?.state === 'ready' ? status.result.device : null;
  return (
    <div className="screen-content">
      <div className="overview-grid">
        <Card className="metric-card">
          <CardHeading>LOCAL DEVICE</CardHeading>
          <strong className="metric-value metric-text">{verified?.deviceName || '—'}</strong>
          <span className="muted">{verified ? 'Response verified from this Local Wall' : 'Not verified'}</span>
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

const gatedScreens: Partial<Record<RouteKey, {
  heading: string;
  intro: string;
  features: string[];
  gate: string;
}>> = {
  sessions: {
    heading: 'Session authority required',
    intro: 'Per-Agent nicknames, session lifecycle and 24-hour leases must come from an authenticated session source.',
    features: ['Active / held / revoked', 'Lease expiry and session names', 'Manual close with signed receipts'],
    gate: 'Sessions remain read-only and unavailable until the source contract is verified.'
  },
  'live-monitor': {
    heading: 'Waiting for verified Agent events',
    intro: 'Running, queued, stop-requested and terminal results must be sourced from signed execution records.',
    features: ['Live redacted activity', 'Job / process details', 'Stop requested is not a terminal state'],
    gate: 'No synthetic logs or fabricated execution states.'
  },
  devices: {
    heading: 'Devices and enrollment',
    intro: 'New Link and Relink require trusted device identity, signed enrollment and explicit Owner verification.',
    features: ['New Link · Owner approval', 'Relink · identity preservation', 'Offline diagnostics and recovery'],
    gate: 'No device enumeration or owner action has been authorized by this preview.'
  },
  'long-memory': {
    heading: 'Long Memory',
    intro: 'Local Home/Replica selection and sync modes require device-scoped capabilities and true module state.',
    features: ['Auto / Follow Project / Manual', 'Storage and last-sync receipts', 'Archive / delete with explicit scope'],
    gate: 'Module status has not been wired to this shell.'
  },
  'codex-bridge': {
    heading: 'Codex Bridge',
    intro: 'Optional local Codex observer and task management depend on installed runtime and permission gates.',
    features: ['Observer state', 'Task history and edit', 'Delete / stop with explicit confirmation'],
    gate: 'No Codex process can be started from this preview.'
  },
  account: {
    heading: 'Account and plan',
    intro: 'Sign-in, plan, quotas and usage per device require verified account ownership and server-issued totals.',
    features: ['Owner identity', 'Plan and quota', 'Device usage by month'],
    gate: 'Unknown plan or call counts remain blank; sign-out is not implemented here.'
  }
};

function GatedScreen({ route }: { route: RouteKey }) {
  const detail = gatedScreens[route];
  if (!detail) return null;
  return (
    <div className="screen-content">
      <Card className="gated-panel">
        <div className="gated-symbol"><Shield size={25} aria-hidden="true" /></div>
        <h2>{detail.heading}</h2>
        <p>{detail.intro}</p>
        <ul>{detail.features.map(item => <li key={item}><CheckCircle2 size={16} aria-hidden="true" />{item}</li>)}</ul>
        <div className="gated-note"><ShieldAlert size={17} aria-hidden="true" />{detail.gate}</div>
      </Card>
    </div>
  );
}

function SettingsPage({ theme, choose, status }: {
  theme: ThemePreference;
  choose: (theme: ThemePreference) => void;
  status: LoadState;
}) {
  return (
    <div className="screen-content settings-layout">
      <Card>
        <CardHeading description="Appearance, local policy and owner-gated actions">SETTINGS GROUPS</CardHeading>
        <div className="settings-menu">
          <strong>Appearance</strong><span>Privacy &amp; Security</span><span>Filesystem Roots</span>
          <span>Desktop Permissions</span><span>Startup / Notifications</span><span>Agent / Updates</span>
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
  const { theme, choose } = useTheme();
  const [status, setStatus] = useState<LoadState>({ phase: 'loading', result: null });
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setStatus({ phase: 'loading', result: null });
    void readLocalWallStatus(fetch, controller.signal).then(result => {
      if (live) setStatus({ phase: 'settled', result });
    });
    return () => { live = false; controller.abort(); };
  }, [reload]);

  // A previously verified connection must not remain shown forever.
  // Poll read-only status while visible and revalidate immediately after returning.
  useEffect(() => {
    const refreshVisible = () => {
      if (!document.hidden) setReload(value => value + 1);
    };
    const timer = window.setInterval(refreshVisible, 15_000);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);

  const navigate = (next: RouteKey) => {
    setRoute(next);
    if (window.location.hash !== routeHref(next)) window.location.hash = routeHref(next);
  };
  const info = titles[route];

  return (
    <div className="app-shell">
      <Sidebar active={route} navigate={navigate} status={status} />
      <main className="main-area" id="main-content">
        <header className="page-header">
          <div className="header-copy">
            <h1>{info.title}</h1>
            <p>{info.subtitle}</p>
          </div>
          <div className="header-actions">
            <Bell size={19} aria-hidden="true" className="header-symbol" />
            <Button variant="ghost" size="icon" aria-label="Open Settings" onClick={() => navigate('settings')}>
              <Settings2 size={19} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Refresh verified Local Wall status"
              title="Refresh read-only Local Wall device state"
              onClick={() => setReload(i => i + 1)} disabled={status.phase === 'loading'}>
              <RefreshCcw size={18} aria-hidden="true" />
            </Button>
            <span className="preview-pill"><span className="status-dot" aria-hidden="true" />PREVIEW · VERIFIED DATA ONLY</span>
          </div>
        </header>
        {route === 'overview' ? <Overview status={status} navigate={navigate} />
          : route === 'ai-access' ? <AiAccess status={status} />
            : route === 'settings' ? <SettingsPage theme={theme} choose={choose} status={status} />
              : <GatedScreen route={route} />}
        <footer className="page-footer">
          <CircleHelp size={14} aria-hidden="true" />
          Desktop V4 pilot · no native Agent control or Owner grant mutations
        </footer>
      </main>
    </div>
  );
}
