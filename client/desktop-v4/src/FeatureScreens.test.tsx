import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FeatureScreen, type FeatureRoute } from './FeatureScreens';

afterEach(cleanup);
const rows: Array<{ route: FeatureRoute; title: string; table: string }> = [
  { route: 'sessions', title: 'AI SESSIONS', table: 'AI sessions' },
  { route: 'live-monitor', title: 'JOB CONTROLLER', table: 'Agent jobs' },
  { route: 'devices', title: 'DEVICES', table: 'Devices inventory' },
  { route: 'long-memory', title: 'MEMORY LIBRARY', table: 'Long Memory scopes' },
  { route: 'codex-bridge', title: 'CODEX TASKS', table: 'Codex tasks' },
  { route: 'account', title: 'USAGE BY DEVICE', table: 'Usage by device' }
];

describe('desktop V4 feature screen integrity', () => {
  for (const { route, title, table } of rows) {
    it(route + ' exposes a distinct structured view, not a generic placeholder', () => {
      render(<FeatureScreen route={route} status={null} />);
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
      expect(screen.getByRole('region', { name: table })).toBeTruthy();
      expect(screen.getByText('Verified source unavailable')).toBeTruthy();
      expect(screen.getByText('Records not verified')).toBeTruthy();
    });
  }
  it('locks all unverified interaction controls, not merely styling them inactive', () => {
    for (const route of ['devices', 'long-memory', 'codex-bridge', 'account'] as FeatureRoute[]) {
      const view = render(<FeatureScreen route={route} status={null} />);
      const buttons = view.container.querySelectorAll('button');
      if (route === 'devices') {
        // Link/Relink is an OS-local Tray action, not an unverified Owner
        // mutation on this inventory screen. Show the real navigation path.
        expect(buttons.length).toBe(0);
        expect(view.container.textContent).toContain('Windows Tray');
        expect(view.container.textContent).toContain('Link / Relink');
      } else {
        expect(buttons.length).toBeGreaterThan(0);
        buttons.forEach(button => expect(button.disabled).toBe(true));
      }
      view.unmount();
    }
  });
  it('displays unknown rather than inventing zero devices, calls or jobs', () => {
    for (const route of ['devices', 'account', 'live-monitor'] as FeatureRoute[]) {
      const view = render(<FeatureScreen route={route} status={null} />);
      expect(view.container.querySelectorAll('.feature-kpi-value').length).toBe(3);
      expect(Array.from(view.container.querySelectorAll('.feature-kpi-value')).every(node => node.textContent === '—')).toBe(true);
      view.unmount();
    }
  });

  it('shows only Owner-reported per-device usage in Account',()=>{
    const snapshot={
      state:'ready' as const,accountId:'owner',asOf:1000,
      account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true},
      entitlements:{plan:'pro',toolCallLimit:500},
      usage:{month:'2026-11',toolCallsThisMonth:22,byDevice:[{deviceId:'dev-a',toolCalls:19,onlineMs:7200000}]},
      devices:[{deviceId:'dev-a',name:'Workstation',shortId:'R01KAP',os:'windows',state:'online',lastSeenAt:100}],
      sessions:[],grants:[],jobs:[],events:[],coverage:null
    };
    render(<FeatureScreen route="account" status={null} snapshot={snapshot} />);
    expect(screen.getByText('owner@example.test')).toBeTruthy();
    expect(screen.getByText('Workstation')).toBeTruthy();
    expect(screen.getByText('2026-11')).toBeTruthy();
    expect(screen.getByText('19')).toBeTruthy();
    expect(screen.getByText('2.0')).toBeTruthy();
  });
  it('renders only verified, sanitized Operator jobs and recent events',()=>{
    const snapshot={
      state:'ready' as const,accountId:'owner',asOf:1000,
      account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true},
      entitlements:{plan:'pro',toolCallLimit:500},
      usage:{month:'2026-11',toolCallsThisMonth:22,byDevice:[]},
      devices:[{deviceId:'dev-a',name:'Workstation',shortId:'R01KAP',os:'windows',state:'online',lastSeenAt:100}],
      sessions:[],grants:[],coverage:{jobs:{returned:1,total:257,hasMore:true,source:'in_memory_current_window' as const}},
      jobs:[{jobId:'j-123',deviceId:'dev-a',agentId:'agent-a',sessionId:'s-1',state:'running',startedAt:1000,finishedAt:null,exitCode:null}],
      events:[{deviceId:'dev-a',eventType:'job_started',status:'running',at:1001}]
    };
    render(<FeatureScreen route="live-monitor" status={null} snapshot={snapshot}/>);
    expect(screen.getByRole('region',{name:'Agent jobs'})).toBeTruthy();
    expect(screen.getByRole('region',{name:'Live activity events'})).toBeTruthy();
    expect(screen.getByText('j-123')).toBeTruthy();
    expect(screen.getByText('job_started')).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.getByText('Current in-memory job window')).toBeTruthy();
    expect(screen.getByText('≥1')).toBeTruthy();
    expect(screen.queryByText('Activity stream unverified')).toBeNull();
  });
  it('shows bounded session history without misreporting active/held counts',()=>{
    const snapshot={
      state:'ready' as const,accountId:'owner',asOf:1000,
      account:{email:'owner@example.test',plan:'pro',status:'active',emailVerified:true},
      entitlements:{plan:'pro',toolCallLimit:500},
      usage:{month:'2026-11',toolCallsThisMonth:1,byDevice:[]},
      devices:[{deviceId:'dev-a',name:'Workstation',shortId:'R01KAP',os:'windows',state:'online',lastSeenAt:100}],
      sessions:[
        {sessionId:'s-live',deviceId:'dev-a',agentId:'agent-a',name:'Live',
         state:'active' as const,createdAt:100,lastSeenAt:100,expiresAt:3000,holdReason:null,activeJobs:0},
        {sessionId:'s-closed',deviceId:'dev-a',agentId:'agent-b',name:'Closed',
         state:'closed' as const,createdAt:90,lastSeenAt:95,expiresAt:null,holdReason:null,activeJobs:0}
      ],
      grants:[],jobs:[],events:[],
      coverage:{jobs:{returned:0,total:0,hasMore:false,source:'in_memory_current_window' as const},
        sessions:{returned:2,total:201,hasMore:true,activeTotal:1,holdTotal:0,
          source:'in_memory_current_window' as const}}
    };
    render(<FeatureScreen route="sessions" status={null} snapshot={snapshot}/>);
    expect(screen.getByText(/Showing 2 of 201 Owner sessions/)).toBeTruthy();
    expect(screen.getByText('Verified session window — not complete history')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
  });
  it('a known local device connection must not be taken as job or owner authority', () => {
    render(<FeatureScreen route="live-monitor" status={{
      state: 'ready', device: { verifiedAt: 42, deviceName: 'Test', connection: 'connected', cloudState: 'connected' }
    }} />);
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Agent jobs' })).toBeTruthy();
    expect(screen.getByText('Records not verified')).toBeTruthy();
  });
});
