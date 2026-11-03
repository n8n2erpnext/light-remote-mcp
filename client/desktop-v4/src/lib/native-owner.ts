/**
 * Native Desktop V4 Owner session projection.
 * Tokens are NEVER passed through this interface. Only fixed, audited Tauri
 * methods may be invoked; a native Owner status alone is not an A/B grant or
 * authenticated Local Wall status.
 */
export type NativeOwnerPhase = 'signed_out' | 'browser_pending' | 'restoring' |
  'verified' | 'expired' | 'unavailable';

export type NativeOwnerView = Readonly<{
  phase: NativeOwnerPhase;
  accountId: string | null;
}>;

const CLOSED: NativeOwnerView = Object.freeze({ phase: 'unavailable', accountId: null });
const phases = new Set<NativeOwnerPhase>([
  'signed_out', 'browser_pending', 'restoring', 'verified', 'expired'
]);
type Host = Window & {
  __TAURI_INTERNALS__?: {
    invoke?: (command: string) => Promise<unknown>;
  }
};

export function nativeOwnerAvailable(host: Window = window): boolean {
  return import.meta.env.VITE_LR_V4_OWNER_LOGIN === '1' &&
    typeof (host as Host).__TAURI_INTERNALS__?.invoke === 'function';
}

function validView(value: unknown): NativeOwnerView {
  if (!value || typeof value !== 'object') return CLOSED;
  const row = value as Record<string, unknown>;
  if (!phases.has(row.phase as NativeOwnerPhase)) return CLOSED;
  const accountId = typeof row.accountId === 'string' &&
    /^[A-Za-z0-9._:-]{1,128}$/.test(row.accountId) ? row.accountId : null;
  if (row.phase === 'verified' && !accountId) return CLOSED;
  return Object.freeze({
    phase: row.phase as NativeOwnerPhase,
    accountId: row.phase === 'verified' ? accountId : null
  });
}

async function ownerCommand(command: 'desktop_owner_begin' | 'desktop_owner_status' |
  'desktop_owner_restore' | 'desktop_owner_logout', host: Window): Promise<NativeOwnerView> {
  if (!nativeOwnerAvailable(host)) return CLOSED;
  try {
    const result = await (host as Host).__TAURI_INTERNALS__!.invoke!(command);
    return validView(result);
  } catch { return CLOSED; }
}
export function nativeOwnerBegin(host: Window = window) {
  return ownerCommand('desktop_owner_begin', host);
}
export function nativeOwnerStatus(host: Window = window) {
  return ownerCommand('desktop_owner_status', host);
}
export function nativeOwnerRestore(host: Window = window) {
  return ownerCommand('desktop_owner_restore', host);
}
export function nativeOwnerLogout(host: Window = window) {
  return ownerCommand('desktop_owner_logout', host);
}
