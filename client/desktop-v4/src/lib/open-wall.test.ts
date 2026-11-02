import { describe, expect, it, vi } from 'vitest';
import { nativeOpenWallAvailable, openLocalWall } from './open-wall';

describe('V4 fixed native browser bridge', () => {
  it('does nothing in a plain web preview without native IPC', async () => {
    const host = {} as Window;
    expect(nativeOpenWallAvailable(host)).toBe(false);
    expect(await openLocalWall('home', host)).toEqual({
      state: 'unavailable', reason: 'native_browser_bridge_unavailable'
    });
  });
  it('passes only a view name, never an untrusted URL or Owner credential', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const host = { __TAURI_INTERNALS__: { invoke } } as unknown as Window;
    expect(nativeOpenWallAvailable(host)).toBe(true);
    expect(await openLocalWall('logs', host)).toEqual({ state: 'opened' });
    expect(invoke).toHaveBeenCalledWith('open_local_wall', { view: 'logs' });
  });
  it('fails closed on unavailable native browser', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('no browser'));
    const host = { __TAURI_INTERNALS__: { invoke } } as unknown as Window;
    expect(await openLocalWall('home', host)).toEqual({
      state: 'unavailable', reason: 'local_wall_browser_launch_failed'
    });
  });
});
