/** Owner-scoped, read-only LOCAL Wall log summary. No cross-origin fetch. */
export type LogPreset = 'compact' | 'standard' | 'extended';
export type LogState = {
  preset: LogPreset;
  usedBytes: number;
  maxDiskBytes: number;
  ramEvents: number;
  lastError: string | null;
};
export type LocalLogResult = { state: 'ready'; log: LogState } |
  { state: 'unavailable'; reason: string };

function object(value: unknown): Record<string, unknown> | null {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export function projectLogState(raw: unknown): LocalLogResult {
  const body = object(raw);
  if (body?.ok !== true) return { state: 'unavailable', reason: 'log_status_not_authoritative' };
  const log = object(body.log);
  if (!log) return { state: 'unavailable', reason: 'log_status_missing' };
  const preset = log.preset;
  const isValidNumber = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0;
  if ((preset !== 'compact' && preset !== 'standard' && preset !== 'extended') ||
      !isValidNumber(log.usedBytes) || !isValidNumber(log.maxDiskBytes) ||
      !isValidNumber(log.ramEvents) || Number(log.usedBytes) > Number(log.maxDiskBytes) ||
      (log.lastError !== null && log.lastError !== undefined && typeof log.lastError !== 'string'))
    return { state: 'unavailable', reason: 'log_status_invalid' };
  return { state: 'ready', log: {
    preset, usedBytes: Number(log.usedBytes), maxDiskBytes: Number(log.maxDiskBytes),
    ramEvents: Number(log.ramEvents), lastError: typeof log.lastError === 'string' ? log.lastError.slice(0, 100) : null
  }};
}

export async function readLocalLogState(transport: typeof fetch = fetch, signal?: AbortSignal): Promise<LocalLogResult> {
  try {
    const response = await transport('/api/activity/logs/state', {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'manual',
      signal, headers: { Accept: 'application/json' }
    });
    if (!response.ok) return { state: 'unavailable', reason: 'http_' + response.status };
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json'))
      return { state: 'unavailable', reason: 'log_status_not_json' };
    return projectLogState(await response.json() as unknown);
  } catch {
    return { state: 'unavailable', reason: signal?.aborted ? 'cancelled' : 'local_wall_unreachable' };
  }
}
