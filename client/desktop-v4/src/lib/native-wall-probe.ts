/**
 * Strict native, anonymous loopback presence probe.
 * A reachable Wall is NEVER evidence of Owner authentication or Agent grant.
 */
export type NativeWallProbe = 'unavailable' | 'owner_login_required' | 'responding_unverified';
type NativeWindow = Window & { __TAURI_INTERNALS__?: {
  invoke?: (name: string, args?: Record<string, unknown>) => Promise<unknown>
}};
export async function probeNativeLocalWall(host: Window = window): Promise<NativeWallProbe> {
  const invoke = (host as NativeWindow).__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') return 'unavailable';
  try {
    const result: unknown = await invoke('probe_local_wall');
    if (result === 'owner_login_required' || result === 'responding_unverified') return result;
  } catch { /* no device state has been authenticated */ }
  return 'unavailable';
}
