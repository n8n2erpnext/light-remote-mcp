import type { ReactNode } from 'react';
import {
  Activity, Clock3, Database, HardDrive, KeyRound, LockKeyhole,
  Monitor, Search, Server, ShieldAlert, TerminalSquare, Users, WifiOff,
  type LucideIcon
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardHeading } from './components/ui/card';
import type { RouteKey } from './lib/routes';
import type { SnapshotResult } from './lib/status';

export type FeatureRoute = Extract<RouteKey,
  'sessions' | 'live-monitor' | 'devices' | 'long-memory' | 'codex-bridge' | 'account'>;

/* These are Figma-aligned views only, not inferred Owner/Agent data. */
function UnknownKpi({ label, hint, icon: Icon, value = '—' }: {
  label: string; hint: string; icon: LucideIcon; value?: string;
}) {
  return <Card className="feature-kpi">
    <div className="feature-kpi-top"><span className="eyebrow">{label}</span><Icon size={18} aria-hidden="true" /></div>
    <strong className="feature-kpi-value">{value}</strong>
    <span className="muted">{hint}</span>
  </Card>;
}
function SourceUnavailable({ description }: { description: string }) {
  return <div className="feature-unavailable" role="status">
    <ShieldAlert size={18} aria-hidden="true" />
    <div><strong>Verified source unavailable</strong><p>{description}</p></div>
  </div>;
}
function EmptyPanel({ title, children }: { title: string; children: ReactNode }) {
  return <div className="feature-empty">
    <LockKeyhole size={24} aria-hidden="true" />
    <h3>{title}</h3><p>{children}</p>
  </div>;
}
function DisabledControl({ children }: { children: ReactNode }) {
  return <Button variant="secondary" disabled title="Requires a verified, authorized backend capability">{children}</Button>;
}
function FeatureTable({ columns, label, description }: {
  columns: string[]; label: string; description: string;
}) {
  return <div className="feature-table" role="region" aria-label={label}>
    <div className="feature-table-scroll"><table>
      <thead><tr>{columns.map(col => <th scope="col" key={col}>{col}</th>)}</tr></thead>
      <tbody><tr><td colSpan={columns.length}><EmptyPanel title="Records not verified">{description}</EmptyPanel></td></tr></tbody>
    </table></div>
  </div>;
}
function FilterBar({ label, action }: { label: string; action?: string }) {
  return <div className="feature-filterbar">
    <label className="feature-filter">
      <Search size={16} aria-hidden="true" />
      <input aria-label={label} type="search" placeholder={label} disabled />
    </label>
    {action ? <DisabledControl>{action}</DisabledControl> : null}
  </div>;
}
function Sessions() {
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="ACTIVE SESSIONS" hint="Signed sessions required" icon={Users} />
      <UnknownKpi label="HELD / PENDING" hint="Lease state not verified" icon={LockKeyhole} />
      <UnknownKpi label="NEXT EXPIRY" hint="No verified lease deadline" icon={Clock3} />
    </div>
    <Card>
      <div className="feature-section-title">
        <CardHeading description="Sessions, nicknames, 24-hour leases and server receipts">AI SESSIONS</CardHeading>
        <span className="feature-state-label">UNVERIFIED</span>
      </div>
      <FilterBar label="Search verified sessions" action="Filter status" />
      <FeatureTable label="AI sessions" columns={['Agent / nickname', 'Device', 'Lease', 'State', 'Action']}
        description="A signed session collection is required before displaying rows, expiry times or close controls." />
    </Card>
    <SourceUnavailable description="Session listing and manual close require Owner authorization. No session query or mutation was sent." />
  </div>;
}
function LiveMonitor({ status }: { status: SnapshotResult | null }) {
  const v = status?.state === 'ready' ? status.device : null;
  const connection = v?.connection === 'connected' ? 'Connected'
    : v?.connection === 'disconnected' ? 'Disconnected' : '—';
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="LOCAL CONNECTION" hint={v ? 'Read-only Local Wall response' : 'Not verified'} icon={WifiOff} value={connection} />
      <UnknownKpi label="RUNNING JOBS" hint="Signed job list unavailable" icon={Activity} />
      <UnknownKpi label="EVENTS" hint="Verified event feed unavailable" icon={Clock3} />
    </div>
    <div className="feature-split">
      <Card>
        <div className="feature-section-title"><CardHeading description="Redacted signed events only">LIVE ACTIVITY</CardHeading>
          <span className="feature-state-label">NO FEED</span></div>
        <EmptyPanel title="Activity stream unverified">No activity or timeline is inferred from an unavailable feed.</EmptyPanel>
      </Card>
      <Card>
        <CardHeading description="Executor availability must come from the local Agent">EXECUTOR STATUS</CardHeading>
        <div className="feature-pairs">
          <div><span>Executor ready</span><strong>—</strong></div>
          <div><span>Connection</span><strong>{connection}</strong></div>
          <div><span>Last authenticated event</span><strong>—</strong></div>
        </div>
      </Card>
    </div>
    <Card>
      <CardHeading description="RUNNING / QUEUED / STOP-REQUESTED / OK / ERROR / TIMEOUT / KILLED">JOB CONTROLLER</CardHeading>
      <FeatureTable label="Agent jobs" columns={['Job', 'Device', 'Status', 'Started', 'Action']}
        description="Job cancellation is unavailable until a signed execution controller is connected. Stop-requested is not a terminal state." />
    </Card>
    <SourceUnavailable description="A Local Wall device snapshot cannot authorize job inspection, cancellation or execution. No synthetic records are displayed." />
  </div>;
}
function Devices() {
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="MY DEVICES" hint="Owner device list unavailable" icon={Monitor} />
      <UnknownKpi label="ONLINE DEVICES" hint="Full fleet state not verified" icon={Server} />
      <UnknownKpi label="PENDING LINKS" hint="Enrollment requests unavailable" icon={KeyRound} />
    </div>
    <Card>
      <div className="feature-section-title">
        <CardHeading description="Owner-scoped device inventory with stable Short IDs">DEVICES</CardHeading>
        <div className="feature-actions"><DisabledControl>New Link</DisabledControl><DisabledControl>Relink</DisabledControl></div>
      </div>
      <FilterBar label="Search verified devices" action="Filter devices" />
      <FeatureTable label="Devices inventory" columns={['Device', 'Short ID', 'OS', 'Connection', 'Last seen', 'Action']}
        description="No devices can be enumerated from this pilot. New Link and Relink require signed enrollment with identity preservation." />
    </Card>
    <SourceUnavailable description="A/B V2 code refresh, enrollment polling, device changes and Owner recovery are blocked pending verified capability contracts." />
  </div>;
}
function LongMemory() {
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="MODULE STATE" hint="Module lifecycle not bound" icon={Database} />
      <UnknownKpi label="MEMORY HOME" hint="Local Home not verified" icon={Server} />
      <UnknownKpi label="TOTAL STORAGE" hint="No validated storage measurement" icon={HardDrive} />
    </div>
    <div className="feature-split">
      <Card>
        <CardHeading description="Auto, Follow Project or Manual — selected by the actual Agent">SYNC CONFIGURATION</CardHeading>
        <div className="feature-form-row">
          <label htmlFor="memory-sync-mode">Sync Mode</label>
          <select id="memory-sync-mode" disabled defaultValue="unknown">
            <option value="unknown">Not verified</option>
          </select>
        </div>
        <div className="feature-pairs">
          <div><span>Memory Home</span><strong>—</strong></div>
          <div><span>Last sync</span><strong>—</strong></div>
        </div>
        <DisabledControl>Change Memory Home</DisabledControl>
      </Card>
      <Card>
        <CardHeading description="Explicit device checkbox and replication status">REPLICA DEVICES</CardHeading>
        <EmptyPanel title="Replica list unavailable">The Home and Replica controls stay disabled without trusted module/device state.</EmptyPanel>
      </Card>
    </div>
    <Card>
      <CardHeading description="Local scopes, archive, deletion and storage receipts">MEMORY LIBRARY</CardHeading>
      <FeatureTable label="Long Memory scopes" columns={['Scope', 'Storage', 'Updated', 'Sync', 'Action']}
        description="Archive and device/account-wide deletion must be confirmed against exact signed scope; no collection has been loaded." />
    </Card>
    <SourceUnavailable description="Long Memory status is not inferred from device connectivity. No archive, sync or deletion action can run." />
  </div>;
}
function CodexBridge() {
  return <div className="screen-content feature-dashboard">
    <div className="feature-split">
      <Card>
        <CardHeading description="Optional per-device module state">CODEX BRIDGE</CardHeading>
        <div className="feature-status-hero"><TerminalSquare size={27} aria-hidden="true" />
          <div><strong>Module state unverified</strong><p>No Codex process or observer is started by this UI.</p></div></div>
        <DisabledControl>Enable Codex Bridge</DisabledControl>
      </Card>
      <Card>
        <CardHeading description="Locally installed Codex executable and consent">RUNTIME STATUS</CardHeading>
        <div className="feature-pairs">
          <div><span>Codex binary</span><strong>—</strong></div>
          <div><span>Observer</span><strong>—</strong></div>
          <div><span>Last task</span><strong>—</strong></div>
        </div>
        <DisabledControl>Check runtime</DisabledControl>
      </Card>
    </div>
    <Card>
      <CardHeading description="Create, edit, approve and delete only with exact scope">CODEX TASKS</CardHeading>
      <FilterBar label="Search verified Codex tasks" action="Create task" />
      <FeatureTable label="Codex tasks" columns={['Task', 'Device', 'History', 'State', 'Action']}
        description="No tasks have been fetched. Delete / stop / edit require the native module authority and confirmation." />
    </Card>
    <SourceUnavailable description="The bridge is optional and this pilot has no process authority or task provider." />
  </div>;
}
function Account() {
  return <div className="screen-content feature-dashboard">
    <div className="feature-split">
      <Card>
        <CardHeading description="Owner identity verified by the actual account service">MY ACCOUNT</CardHeading>
        <div className="feature-identity"><div className="feature-avatar" aria-hidden="true">?</div>
          <div><strong>Identity not verified</strong><p>No Owner profile loaded</p></div></div>
        <DisabledControl>Sign in to account</DisabledControl>
      </Card>
      <Card>
        <CardHeading description="Free / Pro / VIP from server only">CURRENT PLAN</CardHeading>
        <div className="feature-pairs">
          <div><span>Plan</span><strong>—</strong></div>
          <div><span>Monthly call allowance</span><strong>—</strong></div>
          <div><span>Remaining calls</span><strong>—</strong></div>
        </div>
      </Card>
    </div>
    <div className="feature-kpi-grid">
      <UnknownKpi label="CALLS THIS MONTH" hint="No account-scoped totals" icon={Activity} />
      <UnknownKpi label="DEVICES IN ACCOUNT" hint="Owner device inventory absent" icon={Monitor} />
      <UnknownKpi label="CURRENT BILLING PERIOD" hint="Not verified" icon={Clock3} />
    </div>
    <Card>
      <CardHeading description="Only server-issued call counts per verified device">USAGE BY DEVICE</CardHeading>
      <FeatureTable label="Usage by device" columns={['Device', 'Month', 'Calls', 'Allowance', 'Plan']}
        description="Unknown call counts remain blank. No free/Pro/VIP identity is inferred from Local Wall status." />
    </Card>
    <SourceUnavailable description="Account identity, logout, billing, upgrade and usage need verified account APIs, which are not connected." />
  </div>;
}

export function FeatureScreen({ route, status }: { route: FeatureRoute; status: SnapshotResult | null }) {
  switch (route) {
    case 'sessions': return <Sessions />;
    case 'live-monitor': return <LiveMonitor status={status} />;
    case 'devices': return <Devices />;
    case 'long-memory': return <LongMemory />;
    case 'codex-bridge': return <CodexBridge />;
    case 'account': return <Account />;
  }
}
