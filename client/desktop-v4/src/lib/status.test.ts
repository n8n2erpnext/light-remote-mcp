import { describe, it, expect, vi } from 'vitest';
import { projectLocalStatus, readLocalWallStatus } from './status';

describe('owner-safe status projection', () => {
  it('does not treat empty or guessed data as connected', () => {
    expect(projectLocalStatus(null)).toEqual({ state: 'unavailable', reason: 'status_not_authoritative' });
    expect(projectLocalStatus({ ok: true })).toEqual({ state: 'unavailable', reason: 'local_status_absent' });
    const partial = projectLocalStatus({ ok: true, local: { cloudState: 'connected' } });
    expect(partial.state).toBe('ready');
    if (partial.state === 'ready') expect(partial.device.connection).toBe('unknown');
  });

  it('requires both cloud fields to establish connection', () => {
    const yes = projectLocalStatus({
      ok: true,
      local: { deviceName: 'Win 11', cloudState: 'connected', cloudDesiredConnected: true }
    }, 1000);
    expect(yes).toEqual({
      state: 'ready',
      device: { deviceName: 'Win 11', cloudState: 'connected', connection: 'connected', verifiedAt: 1000 }
    });
    const wrong = projectLocalStatus({
      ok: true, local: { cloudState: 'connected', cloudDesiredConnected: false }
    });
    if (wrong.state === 'ready') expect(wrong.device.connection).toBe('unknown');
  });

  it('discards arbitrary backend fields rather than surfacing secrets', () => {
    const data = projectLocalStatus({
      ok: true,
      local: { deviceName: 'Lab', cloudDesiredConnected: false, cloudState: 'disconnected', secret: 'NO' },
      remote: { account: { token: 'DO_NOT_EXPOSE' } }
    });
    expect(JSON.stringify(data)).not.toMatch(/NO|DO_NOT_EXPOSE/);
  });

  it('rejects HTML login redirects and handles an unauthenticated Wall', async () => {
    const html = vi.fn().mockResolvedValue(new Response('<html></html>', {
      status: 200, headers: { 'content-type': 'text/html' }
    }));
    const result = await readLocalWallStatus(html, undefined, 9);
    expect(result).toEqual({ state: 'unavailable', reason: 'status_not_json' });
    expect(html).toHaveBeenCalledWith('/api/status', expect.objectContaining({
      credentials: 'same-origin', redirect: 'manual', cache: 'no-store', method: 'GET'
    }));
  });

  it('does not retry/approve or turn HTTP 401 into a successful state', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    expect(await readLocalWallStatus(transport)).toEqual({ state: 'unavailable', reason: 'http_401' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('checks JSON response and degrades safely when unreachable', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('offline'));
    expect(await readLocalWallStatus(transport)).toEqual({ state: 'unavailable', reason: 'wall_unreachable' });
  });
});
