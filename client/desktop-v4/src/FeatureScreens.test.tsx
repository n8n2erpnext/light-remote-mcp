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
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach(button => expect(button.disabled).toBe(true));
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
  it('a known local device connection must not be taken as job or owner authority', () => {
    render(<FeatureScreen route="live-monitor" status={{
      state: 'ready', device: { verifiedAt: 42, deviceName: 'Test', connection: 'connected', cloudState: 'connected' }
    }} />);
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Agent jobs' })).toBeTruthy();
    expect(screen.getByText('Records not verified')).toBeTruthy();
  });
});
