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
import type { OwnerSnapshot,OwnerDevice,OwnerJob,OwnerSession } from './lib/native-snapshot';
import type {UsageDeviceRow} from './lib/native-activity';
import {useOwnerActivity} from './lib/use-owner-activity';
import {useOwnerInventory} from './lib/use-owner-inventory';

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
function Sessions({snapshot,ownerAccountId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null}) {
  const activity=useOwnerActivity('sessions',snapshot?ownerAccountId:null);
  const paged=Boolean(snapshot&&ownerAccountId&&activity.pages.length>0);
  const retention=paged?activity.pages[0]?.coverage.retention:undefined;
  const rows:ReadonlyArray<OwnerSession>=paged?activity.rows.filter(
    (row):row is OwnerSession=>'createdAt' in row):snapshot?.sessions||[];
  const coverage=snapshot?.coverage?.sessions;
  const active=coverage?.activeTotal??rows.filter(s=>s.state==='active').length;
  const hold=coverage?.holdTotal??rows.filter(s=>s.state==='hold').length;
  const expiries=rows.filter(s=>s.expiresAt!==null&&
    (s.state==='active'||s.state==='hold'))
    .map(s=>s.expiresAt as number).sort((a,b)=>a-b);
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="ACTIVE SESSIONS" hint={snapshot?'Owner verified':'Signed sessions required'} icon={Users}
        value={snapshot?String(active):'—'} />
      <UnknownKpi label="HELD / PENDING" hint={snapshot?'Live Agent lanes':'Lease state not verified'} icon={LockKeyhole}
        value={snapshot?String(hold):'—'} />
      <UnknownKpi label="NEXT EXPIRY" hint={coverage?.hasMore?'Earliest among visible leases · partial window':'Server-reported lease deadline'} icon={Clock3}
        value={snapshot&&expiries.length?timestamp(expiries[0]??null):'—'} />
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
    {snapshot&&(coverage?.hasMore||retention)&&<div className="feature-unavailable" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <div><strong>Verified session window — not complete history</strong>
        <p>{paged?'Showing '+activity.loaded+' of '+activity.total+(activity.pages[0]?.coverage.source==='redis_retained_session_window'?' Redis-backed retained':' current in-memory')+' Owner sessions.':
          'Showing '+coverage?.returned+' of '+coverage?.total+' Owner sessions; loading verified page.'} Not an immutable audit archive. Owner close actions are not connected.</p>
        {retention&&<p>Redis snapshot TTL: {Math.round(retention.snapshotTtlSeconds/86400)} days (renewed on writes). Terminal sessions are pruned after {Math.round(retention.terminalPruneAfterMs/86400000)} days from closure or expiry. Older entries may no longer exist.</p>}
        {paged&&activity.hasMore&&<Button disabled={activity.pending} onClick={()=>void activity.loadMore()}>
          {activity.pending?'Loading…':'Load more sessions'}</Button>}</div>
    </div>}
    {activity.error&&<p role="alert">{activity.error}</p>}
    {!snapshot&&<SourceUnavailable description="Owner session listing unavailable. No session query or mutation was authorized." />}
  </div>;
}
function LiveMonitor({ status,snapshot,ownerAccountId }: { status: SnapshotResult | null; snapshot:OwnerSnapshot|null;ownerAccountId:string|null }) {
  const v = status?.state === 'ready' ? status.device : null;
  const connection = v?.connection === 'connected' ? 'Connected'
    : v?.connection === 'disconnected' ? 'Disconnected' : '—';
  // PostgreSQL can retain far more Owner jobs than the current in-memory
  // snapshot even when its 200-row coverage is not truncated.
  const activity=useOwnerActivity('jobs',ownerAccountId);
  const paged=Boolean(ownerAccountId)&&activity.pages.length>0;
  const rows:ReadonlyArray<OwnerJob>=paged?activity.rows.filter(
    (row):row is OwnerJob=>'jobId' in row):snapshot?.jobs||[];
  const events=snapshot?.events||[];
  const jobWindowIncomplete=snapshot?.coverage?.jobs.hasMore===true;
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="LOCAL CONNECTION" hint={v ? 'Read-only Local Wall response' : 'Not verified'} icon={WifiOff} value={connection} />
      <UnknownKpi label="RUNNING JOBS" hint={jobWindowIncomplete?'At least this many in the bounded job window':'Current Owner-scoped jobs'} icon={Activity} value={snapshot?(jobWindowIncomplete?'≥':'')+String(snapshot.jobs.filter(j=>j.state==='running').length):'—'} />
      <UnknownKpi label="EVENTS" hint="Recent Operator events" icon={Clock3} value={snapshot?String(events.length):'—'} />
    </div>
    <div className="feature-split">
      <Card>
        <div className="feature-section-title"><CardHeading description="Redacted signed events only">LIVE ACTIVITY</CardHeading>
          <span className="feature-state-label">{snapshot?'RECENT':'NO FEED'}</span></div>
        {snapshot?<div className="feature-table feature-table-scroll" role="region" aria-label="Live activity events">
          <table><thead><tr><th>Event</th><th>Device</th><th>Status</th><th>At</th></tr></thead>
            <tbody>{events.length?events.slice(-20).map((e,i)=><tr key={i}>
              <td>{e.eventType}</td><td>{snapshot.devices.find(d=>d.deviceId===e.deviceId)?.name||e.deviceId}</td>
              <td>{e.status}</td><td>{timestamp(e.at)}</td>
            </tr>):<tr><td colSpan={4}>No recent events</td></tr>}</tbody>
          </table></div>:<EmptyPanel title="Activity stream unverified">No activity or timeline is inferred from an unavailable feed.</EmptyPanel>}
      </Card>
      <Card>
        <CardHeading description="Executor availability must come from the local Agent">EXECUTOR STATUS</CardHeading>
        <div className="feature-pairs">
          <div><span>Executor ready</span><strong>—</strong></div>
          <div><span>Connection</span><strong>{connection}</strong></div>
          <div><span>Last Owner-scoped event</span><strong>{snapshot&&events.length?timestamp(events[events.length-1]?.at??null):'—'}</strong></div>
        </div>
      </Card>
    </div>
    <Card>
      <CardHeading description="RUNNING / QUEUED / STOP-REQUESTED / OK / ERROR / TIMEOUT / KILLED">JOB CONTROLLER</CardHeading>
      {snapshot?<div className="feature-table feature-table-scroll" role="region" aria-label="Agent jobs">
        <table><thead><tr><th>Job</th><th>Device</th><th>Status</th><th>Started</th><th>Action</th></tr></thead>
          <tbody>{rows.length?rows.map(j=><tr key={j.jobId}>
            <td>{j.jobId}</td><td>{snapshot.devices.find(d=>d.deviceId===j.deviceId)?.name||j.deviceId}</td>
            <td>{j.state}</td><td>{timestamp(j.startedAt)}</td><td>Read only</td>
          </tr>):<tr><td colSpan={5}>No jobs in current Owner registry</td></tr>}</tbody>
        </table></div>:<FeatureTable label="Agent jobs" columns={['Job', 'Device', 'Status', 'Started', 'Action']}
        description="Job cancellation is unavailable until a signed execution controller is connected. Stop-requested is not a terminal state." />}
    </Card>
    {snapshot&&(jobWindowIncomplete||paged)&&<div className="feature-unavailable" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <div><strong>{paged&&activity.pages[0]?.coverage.source==='postgresql_owner_job_history'?'PostgreSQL Owner job history':'Current in-memory job window'}</strong>
        <p>Showing {paged?activity.loaded:snapshot.coverage!.jobs.returned} of {paged?activity.total:snapshot.coverage!.jobs.total} Owner jobs. {paged&&activity.pages[0]?.coverage.source==='postgresql_owner_job_history'?'Persisted job metadata only; no command output or cancellation authority.':'Current Operator window only; not complete persisted history.'}</p>
        {paged&&activity.hasMore&&<Button disabled={activity.pending} onClick={()=>void activity.loadMore()}>
          {activity.pending?'Loading…':'Load more jobs'}</Button>}</div>
    </div>}
    {snapshot&&!jobWindowIncomplete&&!paged&&<SourceUnavailable description="Current Operator job view only. Signed PostgreSQL history read may provide additional rows." />}
    {activity.error&&<p role="alert">{activity.error}</p>}
    {!snapshot&&<SourceUnavailable description="A Local Wall device snapshot cannot authorize job inspection, cancellation or execution. No synthetic records are displayed." />}
  </div>;
}
function Devices({snapshot,ownerAccountId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null}) {
  const needsPages=!snapshot||snapshot.coverage?.devices?.hasMore===true;
  const inventory=useOwnerInventory('devices',needsPages?ownerAccountId:null);
  const paged=needsPages&&inventory.pages.length>0;
  const partial=Boolean(snapshot?.coverage?.devices?.hasMore);
  const rows:ReadonlyArray<OwnerDevice>=paged?inventory.rows.filter(
    (row):row is OwnerDevice=>'shortId' in row):snapshot?.devices||[];
  const verified=Boolean(snapshot)||paged;
  return <div className="screen-content feature-dashboard">
    <div className="feature-kpi-grid">
      <UnknownKpi label="MY DEVICES" hint={paged||partial?'Owner verified total · paged inventory':snapshot?'Verified Owner inventory':'Owner device list unavailable'} icon={Monitor} value={verified?String(paged?inventory.total:partial?snapshot?.coverage?.devices?.total:rows.length):'—'} />
      <UnknownKpi label="ONLINE DEVICES" hint={(paged&&inventory.hasMore)||partial?'Visible minimum · more pages available':'Signed account inventory'} icon={Server} value={verified?((paged&&inventory.hasMore)||partial?'≥':'')+String(rows.filter(d=>d.state==='online').length):'—'} />
      <UnknownKpi label="PENDING LINKS" hint="Enrollment requests not bound" icon={KeyRound} />
    </div>
    <Card>
      <div className="feature-section-title">
        <CardHeading description="Owner-scoped device inventory with stable Short IDs">DEVICES</CardHeading>
        <div className="feature-actions"><span className="muted">Link this PC: Windows Tray → Link / Relink</span></div>
      </div>
      {verified?<div className="feature-table feature-table-scroll" role="region" aria-label="Devices inventory">
        <table><thead><tr><th>Device</th><th>Short ID</th><th>OS</th><th>Connection</th><th>Last seen</th></tr></thead>
          <tbody>{rows.length?rows.map(d=><tr key={d.deviceId}><td>{d.name||d.deviceId}</td>
            <td>{d.shortId||'—'}</td><td>{d.os||'—'}</td><td>{d.state}</td>
            <td>{timestamp(d.lastSeenAt)}</td></tr>):<tr><td colSpan={5}>No Owner devices</td></tr>}</tbody>
        </table></div>:<FeatureTable label="Devices inventory"
        columns={['Device','Short ID','OS','Connection','Last seen']}
        description="Owner device collection has not been verified." />}
      {partial&&!paged&&<div className="feature-filterbar" role="status">
        <span>Showing {snapshot!.devices.length} of {snapshot!.coverage!.devices!.total} verified Owner devices. Loading a separate paged view.</span>
      </div>}
      {paged&&<div className="feature-filterbar" role="status">
        <span>Showing {inventory.loaded} of {inventory.total} verified Owner devices. Further pages may change; stale cursors are rejected.</span>
        {inventory.hasMore&&<Button disabled={inventory.pending} onClick={()=>void inventory.loadMore()}>
          {inventory.pending?'Loading…':'Load more devices'}</Button>}
      </div>}
      {!snapshot&&inventory.error&&<p role="alert">{inventory.error}</p>}
    </Card>
    <SourceUnavailable description="This screen is Owner inventory, not a device mutation panel. To link this Windows PC, open the Light Remote system tray icon → Link / Relink (disconnect from Local Wall first if connected). Approval opens in your browser. GoldABV2 V4 has a separate device profile and does not reuse Gold production enrollment." />
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
function Account({snapshot,ownerAccountId}:{snapshot:OwnerSnapshot|null;ownerAccountId:string|null}) {
  const needsPage=snapshot?.coverage?.usage?.hasMore===true;
  const activity=useOwnerActivity('usage',needsPage?ownerAccountId:null);
  const paged=needsPage&&activity.pages.length>0;
  const usageRows:ReadonlyArray<UsageDeviceRow>=paged?activity.rows.filter(
    (row):row is UsageDeviceRow=>'toolCalls' in row):snapshot?.usage.byDevice||[];
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
        value={snapshot?String(snapshot.coverage?.devices?.total??snapshot.devices.length):'—'} />
      <UnknownKpi label="CURRENT BILLING PERIOD" hint="Billing dates not bound" icon={Clock3} />
    </div>
    <Card><CardHeading description="Server-issued monthly usage by Owner device">USAGE BY DEVICE</CardHeading>
      {snapshot?<div className="feature-table feature-table-scroll" role="region" aria-label="Usage by device">
        <table><thead><tr><th>Device</th><th>Month</th><th>Calls</th><th>Online hours</th><th>Plan</th></tr></thead>
          <tbody>{usageRows.length?usageRows.map(row=><tr key={row.deviceId}>
            <td>{snapshot.devices.find(d=>d.deviceId===row.deviceId)?.name||row.deviceId}</td>
            <td>{snapshot.usage.month||'—'}</td><td>{row.toolCalls??'—'}</td>
            <td>{row.onlineMs===null?'—':(row.onlineMs/3600000).toFixed(1)}</td>
            <td>{snapshot.account.plan||'—'}</td>
          </tr>):<tr><td colSpan={5}>No measured usage for this month</td></tr>}</tbody>
        </table></div>:<FeatureTable label="Usage by device" columns={['Device','Month','Calls','Online hours','Plan']}
        description="Per-device usage requires a verified Owner snapshot." />}
    </Card>
    {snapshot?.coverage?.usage?.hasMore&&<div className="feature-unavailable" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <div><strong>Partial per-device usage viewport</strong>
        <p>Showing {paged?activity.loaded:snapshot.coverage.usage.returned} of {paged?activity.total:snapshot.coverage.usage.total} Owner usage records for the current UTC month. Monthly call total is verified; pages may change with live usage.</p>
      {paged&&activity.hasMore&&<Button disabled={activity.pending} onClick={()=>void activity.loadMore()}>
        {activity.pending?'Loading…':'Load more usage'}</Button>}</div>
    </div>}
    {activity.error&&<p role="alert">{activity.error}</p>}
    {!snapshot&&<SourceUnavailable description="Account identity, billing and usage need verified Owner data. No local Wall status is treated as login." />}
  </div>;
}
export function FeatureScreen({ route, status, snapshot,ownerAccountId=null }: { route: FeatureRoute; status: SnapshotResult | null; snapshot?: OwnerSnapshot | null;ownerAccountId?:string|null }) {
  switch (route) {
    case 'sessions': return <Sessions snapshot={snapshot??null} ownerAccountId={ownerAccountId} />;
    case 'live-monitor': return <LiveMonitor status={status} snapshot={snapshot??null} ownerAccountId={ownerAccountId} />;
    case 'devices': return <Devices snapshot={snapshot??null} ownerAccountId={ownerAccountId} />;
    case 'long-memory': return <LongMemory />;
    case 'codex-bridge': return <CodexBridge />;
    case 'account': return <Account snapshot={snapshot??null} ownerAccountId={ownerAccountId} />;
  }
}
