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
import type { OwnerSnapshot } from './lib/native-snapshot';

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
function timestamp(value:number|null) {
  return value===null?'—':new Date(value).toLocaleString();
}
function Sessions({snapshot}:{snapshot:OwnerSnapshot|null}) {
  const rows=snapshot?.sessions||[];
  const active=rows.filter(s=>s.state==='active').length;
  const hold=rows.filter(s=>s.state==='hold').length;
  const expiries=rows.filter(s=>s.expiresAt!==null&&
    (s.state==='active'||s.state==='hold'))
    .map(s=>s.expiresAt as number).sort((a,b)=>a-b);
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="ACTIVE SESSIONS" hint={snapshot?'Owner verified':'Signed sessions required'} icon={Users}
        value={snapshot?String(active):'—'} />
      <UnknownKpi label="HELD / PENDING" hint={snapshot?'Live Agent lanes':'Lease state not verified'} icon={LockKeyhole}
        value={snapshot?String(hold):'—'} />
      <UnknownKpi label="NEXT EXPIRY" hint="Server-reported lease deadline" icon={Clock3}
        value={snapshot&&expiries.length?timestamp(expiries[0]):'—'} />
    </div>
    <Card>
      <div className="feature-section-title">
        <CardHeading description="Owner-scoped signed session registry">AI SESSIONS</CardHeading>
        <span className="feature-state-label">{snapshot?'VERIFIED':'UNVERIFIED'}</span>
      </div>
      {snapshot?<div className="feature-table feature-table-scroll" role="region" aria-label="AI sessions">
        <table><thead><tr><th>Agent / nickname</th><th>Device</th><th>Lease</th><th>State</th><th>Action</th></tr></thead>
          <tbody>{rows.length?rows.map(row=><tr key={row.sessionId}>
            <td>{row.name||row.agentId||'Agent'}<small className="muted"> {row.sessionId}</small></td>
            <td>{snapshot.devices.find(d=>d.deviceId===row.deviceId)?.name||row.deviceId}</td>
            <td>{timestamp(row.expiresAt)}</td><td>{row.state}</td>
            <td>Owner close API not connected</td>
          </tr>):<tr><td colSpan={5}>No sessions in verified Owner registry</td></tr>}</tbody>
        </table>
      </div>:<FeatureTable label="AI sessions" columns={['Agent / nickname','Device','Lease','State','Action']}
         description="Signed Owner session API unavailable. No session list can be inferred." />}
    </Card>
    {!snapshot&&<SourceUnavailable description="Owner session listing unavailable. No session query or mutation was authorized." />}
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
function Devices({snapshot}:{snapshot:OwnerSnapshot|null}) {
  const rows=snapshot?.devices||[];
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="MY DEVICES" hint={snapshot?'Verified Owner inventory':'Owner device list unavailable'} icon={Monitor} value={snapshot?String(rows.length):'—'} />
      <UnknownKpi label="ONLINE DEVICES" hint="Signed account inventory" icon={Server} value={snapshot?String(rows.filter(d=>d.state==='online').length):'—'} />
      <UnknownKpi label="PENDING LINKS" hint="Enrollment requests not bound" icon={KeyRound} />
    </div>
    <Card>
      <div className="feature-section-title">
        <CardHeading description="Owner-scoped device inventory with stable Short IDs">DEVICES</CardHeading>
        <div className="feature-actions"><DisabledControl>New Link</DisabledControl><DisabledControl>Relink</DisabledControl></div>
      </div>
      {snapshot?<div className="feature-table feature-table-scroll" role="region" aria-label="Devices inventory">
        <table><thead><tr><th>Device</th><th>Short ID</th><th>OS</th><th>Connection</th><th>Last seen</th></tr></thead>
          <tbody>{rows.length?rows.map(d=><tr key={d.deviceId}><td>{d.name||d.deviceId}</td>
            <td>{d.shortId||'—'}</td><td>{d.os||'—'}</td><td>{d.state}</td>
            <td>{timestamp(d.lastSeenAt)}</td></tr>):<tr><td colSpan={5}>No Owner devices</td></tr>}</tbody>
        </table></div>:<FeatureTable label="Devices inventory"
        columns={['Device','Short ID','OS','Connection','Last seen']}
        description="Owner device collection has not been verified." />}
    </Card>
    <SourceUnavailable description="New Link, Relink and device mutations require a separate signed Owner mutation contract." />
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
function Account({snapshot}:{snapshot:OwnerSnapshot|null}) {
  return <div className="screen-content feature-dashboard">
    <div className="feature-split">
      <Card><CardHeading description="Owner identity verified by native HTTPS + Operator">MY ACCOUNT</CardHeading>
        <div className="feature-identity"><div className="feature-avatar" aria-hidden="true">{snapshot?.account.email?.[0]?.toUpperCase()||'?'}</div>
          <div><strong>{snapshot?.account.email||'Identity not verified'}</strong>
            <p>{snapshot?'Verified Owner session':'No Owner profile loaded'}</p></div></div>
        {!snapshot&&<DisabledControl>Sign in to account</DisabledControl>}
      </Card>
      <Card><CardHeading description="Server-issued plan only">CURRENT PLAN</CardHeading>
        <div className="feature-pairs">
          <div><span>Plan</span><strong>{snapshot?.account.plan||'—'}</strong></div>
          <div><span>Monthly call allowance</span><strong>{snapshot?.entitlements.toolCallLimit??'—'}</strong></div>
          <div><span>Calls this month</span><strong>{snapshot?.usage.toolCallsThisMonth??'—'}</strong></div>
        </div>
      </Card>
    </div>
    <div className="feature-kpi-grid">
      <UnknownKpi label="CALLS THIS MONTH" hint="Server-issued usage" icon={Activity}
        value={snapshot?String(snapshot.usage.toolCallsThisMonth??'—'):'—'} />
      <UnknownKpi label="DEVICES IN ACCOUNT" hint="Verified Owner inventory" icon={Monitor}
        value={snapshot?String(snapshot.devices.length):'—'} />
      <UnknownKpi label="CURRENT BILLING PERIOD" hint="Billing dates not bound" icon={Clock3} />
    </div>
    <Card><CardHeading description="Owner usage via purpose-scoped native API">USAGE BY DEVICE</CardHeading>
      <FeatureTable label="Usage by device" columns={['Device','Month','Calls','Allowance','Plan']}
        description="Per-device usage remains unavailable until a separately projected server response is implemented." />
    </Card>
    {!snapshot&&<SourceUnavailable description="Account identity, billing and usage need verified Owner data. No local Wall status is treated as login." />}
  </div>;
}
export function FeatureScreen({ route, status, snapshot }: { route: FeatureRoute; status: SnapshotResult | null; snapshot?: OwnerSnapshot | null }) {
  switch (route) {
    case 'sessions': return <Sessions snapshot={snapshot??null} />;
    case 'live-monitor': return <LiveMonitor status={status} />;
    case 'devices': return <Devices snapshot={snapshot??null} />;
    case 'long-memory': return <LongMemory />;
    case 'codex-bridge': return <CodexBridge />;
    case 'account': return <Account snapshot={snapshot??null} />;
  }
}
