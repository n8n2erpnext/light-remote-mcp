import { describe, expect, it, vi } from 'vitest';
import { projectLogState, readLocalLogState } from './local-logs';

const authoritative = {
  ok: true, log: {
    preset: 'standard', usedBytes: 8388608, maxDiskBytes: 209715200,
    ramEvents: 32, directory: '/private/owner-secret', lastError: null
  }
};

describe('V4 Activity Log read-only same-origin boundary', () => {
  it('projects only safe metrics, excluding private host paths and event content', () => {
    expect(projectLogState(authoritative)).toEqual({
      state: 'ready', log: { preset: 'standard', usedBytes: 8388608,
        maxDiskBytes: 209715200, ramEvents: 32, lastError: null }
    });
  });
  it('rejects fake counts, invalid presets, missing source or failed authorizations', () => {
    expect(projectLogState({ ok: true, log: { ...authoritative.log, preset: 'unlimited' } }).state).toBe('unavailable');
    expect(projectLogState({ ok: true, log: { ...authoritative.log, usedBytes: -1 } }).state).toBe('unavailable');
    expect(projectLogState({ ok: false, log: authoritative.log }).state).toBe('unavailable');
  });
  it('never fetches another origin, sends browser credentials or follows login redirect', async () => {
    const transport = vi.fn().mockResolvedValue({
      ok: true, headers: { get: () => 'application/json' }, json: async () => authoritative
    });
    const data = await readLocalLogState(transport as unknown as typeof fetch);
    expect(data.state).toBe('ready');
    expect(transport).toHaveBeenCalledWith('/api/activity/logs/state', expect.objectContaining({
      method: 'GET', credentials: 'same-origin', redirect: 'manual', cache: 'no-store'
    }));
    transport.mockResolvedValue({ ok: false, status: 401 });
    expect((await readLocalLogState(transport as unknown as typeof fetch)).state).toBe('unavailable');
  });
});
