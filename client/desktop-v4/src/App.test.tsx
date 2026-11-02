import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from './App';

const htmlResponse = {
  ok: true, status: 200, headers: { get: () => 'text/html' },
  json: async () => { throw new SyntaxError('HTML is not JSON'); }
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn()
  }));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse));
  window.localStorage.clear();
  window.history.replaceState(null, '', '#/ai-access');
});
afterEach(() => {
  cleanup();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '#/');
});

describe('Desktop V4 fail-closed interaction', () => {
  it('renders nine sidebar destinations and disabled Owner approval action', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
    expect(within(nav).getByRole('link', { name: 'AI Access' }).getAttribute('aria-current')).toBe('page');
    const approval = screen.getByRole('button', { name: 'Review owner requests' }) as HTMLButtonElement;
    expect(approval.disabled).toBe(true);
    expect(screen.getByText('No verified grants')).toBeTruthy();
    expect(screen.getByText(/A\/B V2 capability not verified/)).toBeTruthy();
  });

  it('keeps unauthenticated /api/status as unverified, not connected', async () => {
    render(<App />);
    await screen.findByText('Device state not verified');
    expect(screen.queryByText('Connected · verified Local Wall')).toBeNull();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.objectContaining({
      credentials: 'same-origin', redirect: 'manual'
    }));
  });

  it('navigates and changes local theme without privileged backend calls', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings & Permissions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('lr-v4-theme')).toBe('dark');
    await screen.findByText('Activity logs live on this device');
    // Settings adds one authorized same-origin read-only log status request.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.map(x => x[0])).toEqual([
      '/api/status', '/api/activity/logs/state'
    ]);
  });

  it('renders real Local Wall status but never infers signed Agent grants', async () => {
    const payload = {
      ok: true,
      local: { deviceName: 'QA Windows 10', cloudState: 'connected', cloudDesiredConnected: true },
      remote: { access: { pending: [{ secret: 'FORBIDDEN' }] } }
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: async () => payload
    }));
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(nav).getByRole('link', { name: 'AI Access' }));
    await screen.findByText('Connected · verified Local Wall');
    expect(screen.getByText('QA Windows 10')).toBeTruthy();
    expect(screen.getByText('No verified grants')).toBeTruthy();
    expect(screen.queryByText(/FORBIDDEN/)).toBeNull();
  });
  it('opens native Local Wall and activity logs through exact local-only bridge', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Wall' }));
    expect(invoke).toHaveBeenCalledWith('open_local_wall', { view: 'home' });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    await screen.findByText('Activity logs live on this device');
    fireEvent.click(screen.getByRole('button', { name: /Open Activity Logs in Wall/ }));
    expect(invoke).toHaveBeenCalledWith('open_local_wall', { view: 'logs' });
  });

});
