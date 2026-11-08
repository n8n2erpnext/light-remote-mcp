import { describe, expect, it, vi } from 'vitest';
import { probeNativeLocalWall } from './native-wall-probe';

describe('Anonymous native Wall presence probe', () => {
  it('is disabled in the unprivileged browser view', async () => {
    expect(await probeNativeLocalWall({} as Window)).toBe('unavailable');
  });
  it('reports a locked Local Wall without implying connected Agent', async () => {
    const invoke = vi.fn().mockResolvedValue('owner_login_required');
    const host = { __TAURI_INTERNALS__: { invoke } } as unknown as Window;
    expect(await probeNativeLocalWall(host)).toBe('owner_login_required');
    expect(invoke).toHaveBeenCalledWith('probe_local_wall');
  });
  it('fails closed on forged return values and bridge errors', async () => {
    const invoke = vi.fn().mockResolvedValue({ state: 'connected', token: 'secret' });
    const host = { __TAURI_INTERNALS__: { invoke } } as unknown as Window;
    expect(await probeNativeLocalWall(host)).toBe('unavailable');
    invoke.mockRejectedValueOnce(new Error('Connection refused'));
    expect(await probeNativeLocalWall(host)).toBe('unavailable');
  });
  it('does not mistake a reachable anonymous Wall for Owner verification', async () => {
    const invoke = vi.fn().mockResolvedValue('responding_unverified');
    const host = { __TAURI_INTERNALS__: { invoke } } as unknown as Window;
    expect(await probeNativeLocalWall(host)).toBe('responding_unverified');
  });
});
