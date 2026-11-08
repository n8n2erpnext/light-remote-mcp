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

function renderPreview() {
  const view = render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Explore UI (design preview)' }));
  return view;
}

describe('Desktop V4 fail-closed interaction', () => {

  it('keeps appearance controls out of the Login gate while Settings owns them', () => {
    render(<App />);
    expect(document.querySelector('.auth-theme')).toBeNull();
    expect(screen.queryByRole('button', { name: /Switch to (light|dark) appearance/i })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Welcome to Light Remote' })).toBeTruthy();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('requires entry authentication before any workspace route, even on a direct hash', async () => {
    window.history.replaceState(null, '', '#/sessions');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Welcome to Light Remote' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Continue in browser' }) as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    window.location.hash = '#/settings';
    fireEvent(window, new Event('hashchange'));
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
  });

  it('previews browser waiting, OS lock, revoked and account mismatch without authentication', () => {
    render(<App />);
    for (const [button, title] of [
      ['Browser pending', 'Awaiting secure sign-in'],
      ['App Lock', 'Unlock Light Remote'],
      ['Expired', 'Sign in again to continue'],
      ['Wrong account', 'This is a different account'],
      ['Sign out', 'Keep your device identity']
    ]) {
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    }
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('uses ephemeral UI preview only, never a saved Owner session', () => {
    renderPreview();
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
    expect(screen.getByText('DESIGN PREVIEW · NOT SIGNED IN')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Exit UI preview' }));
    expect(screen.getByRole('heading', { name: 'Welcome to Light Remote' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
    expect(window.localStorage.getItem('lr-v4-auth')).toBeNull();
  });


  it('renders nine sidebar destinations and disabled Owner approval action', () => {
    renderPreview();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
    expect(within(nav).getByRole('link', { name: 'AI Access' }).getAttribute('aria-current')).toBe('page');
    const approval = screen.getByRole('button', { name: 'Review owner requests' }) as HTMLButtonElement;
    expect(approval.disabled).toBe(true);
    expect(screen.getByText('No verified grants')).toBeTruthy();
    expect(screen.getByText(/A\/B V2 capability not verified/)).toBeTruthy();
  });

  it('keeps unauthenticated /api/status as unverified, not connected', async () => {
    renderPreview();
    await screen.findByText('Device state not verified');
    expect(screen.queryByText('Connected · verified Local Wall')).toBeNull();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith('/api/status', expect.objectContaining({
      credentials: 'same-origin', redirect: 'manual'
    }));
  });

  it('navigates and changes local theme without privileged backend calls', async () => {
    renderPreview();
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
    renderPreview();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(nav).getByRole('link', { name: 'AI Access' }));
    await screen.findByText('Connected · verified Local Wall');
    expect(screen.getByText('QA Windows 10')).toBeTruthy();
    expect(screen.getByText('No verified grants')).toBeTruthy();
    expect(screen.queryByText(/FORBIDDEN/)).toBeNull();
  });
  it('labels a native locked Wall without claiming an authenticated Agent', async () => {
    const invoke = vi.fn(async (name: string) => name === 'probe_local_wall'
      ? 'owner_login_required' : undefined);
    Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
    window.history.replaceState(null, '', '#/overview');
    renderPreview();
    await screen.findByText('Wall reachable · Owner login required');
    expect(screen.getByText('Wall responding · Owner login required')).toBeTruthy();
    expect(screen.getByText('Device not verified')).toBeTruthy();
    expect(screen.queryByText('Connected · verified Local Wall')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('probe_local_wall');
  });

  it('opens native Local Wall and activity logs through exact local-only bridge', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    Object.assign(window, { __TAURI_INTERNALS__: { invoke } });
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'Open Wall' }));
    expect(invoke).toHaveBeenCalledWith('open_local_wall', { view: 'home' });
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    fireEvent.click(within(nav).getByRole('link', { name: 'Settings' }));
    await screen.findByText('Activity logs live on this device');
    fireEvent.click(screen.getByRole('button', { name: /Open Activity Logs in Wall/ }));
    expect(invoke).toHaveBeenCalledWith('open_local_wall', { view: 'logs' });
  });

});
