/**
 * Read-only, deliberately narrow projection of an existing Local Wall /api/status.
 * No Agent privileges, Owner cookies, plans, quotas, tokens or session grants are inferred.
 */
export type ConnectionLabel = 'connected' | 'disconnected' | 'unknown';

export interface DeviceSnapshot {
  verifiedAt: number;
  deviceName: string | null;
  connection: ConnectionLabel;
  cloudState: string | null;
}

export type SnapshotResult =
  | { state: 'ready'; device: DeviceSnapshot }
  | { state: 'unavailable'; reason: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function safeText(value: unknown, maxLength = 72): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  if (!clean || clean.length > maxLength || /[\x00-\x1F\x7F]/.test(clean)) return null;
  return clean;
}

export function projectLocalStatus(payload: unknown, now = Date.now()): SnapshotResult {
  const body = record(payload);
  if (body?.ok !== true) return { state: 'unavailable', reason: 'status_not_authoritative' };
  const local = record(body.local);
  if (!local) return { state: 'unavailable', reason: 'local_status_absent' };

  const cloudState = safeText(local.cloudState, 40);
  const desired = local.cloudDesiredConnected;
  let connection: ConnectionLabel = 'unknown';
  if (desired === true && cloudState === 'connected') connection = 'connected';
  if (desired === false && cloudState === 'disconnected') connection = 'disconnected';

  return {
    state: 'ready',
    device: {
      verifiedAt: now,
      deviceName: safeText(local.deviceName, 120),
      cloudState,
      connection
    }
  };
}

export async function readLocalWallStatus(
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
  now = Date.now()
): Promise<SnapshotResult> {
  try {
    // Same-origin only. Never copy Owner cookies/CSRF into a native or remote process.
    const response = await transport('/api/status', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return { state: 'unavailable', reason: 'http_' + response.status };
    const type = response.headers.get('content-type') || '';
    if (!type.toLowerCase().includes('application/json'))
      return { state: 'unavailable', reason: 'status_not_json' };
    return projectLocalStatus(await response.json() as unknown, now);
  } catch (error) {
    if (signal?.aborted) return { state: 'unavailable', reason: 'cancelled' };
    return { state: 'unavailable', reason: error instanceof SyntaxError ? 'status_invalid_json' : 'wall_unreachable' };
  }
}
