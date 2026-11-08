/** Exact native-only Local Wall browser launcher; no arbitrary URL or Owner token. */
export type WallView = 'home' | 'logs';
export type OpenWallResult = { state: 'opened' } | { state: 'unavailable'; reason: string };

type NativeWindow = Window & {
  __TAURI_INTERNALS__?: { invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
};

export function nativeOpenWallAvailable(host: Window = window): boolean {
  return typeof (host as NativeWindow).__TAURI_INTERNALS__?.invoke === 'function';
}

export async function openLocalWall(view: WallView, host: Window = window): Promise<OpenWallResult> {
  const native = (host as NativeWindow).__TAURI_INTERNALS__;
  if (typeof native?.invoke !== 'function')
    return { state: 'unavailable', reason: 'native_browser_bridge_unavailable' };
  try {
    await native.invoke('open_local_wall', { view });
    return { state: 'opened' };
  } catch {
    return { state: 'unavailable', reason: 'local_wall_browser_launch_failed' };
  }
}
