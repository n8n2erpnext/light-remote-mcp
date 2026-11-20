import { createHash } from 'node:crypto';

const providers = ['codex', 'claude', 'gemini'];
const actions = ['capabilities', 'start', 'status', 'events', 'result', 'cancel'];
const identifier = /^[A-Za-z0-9._:-]{1,160}$/;
const jobIdentifier = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function workerError(code) {
  return new Error('api_worker_' + code);
}

export function workerActorKey(actor) {
  const fields = ['accountId', 'deviceId', 'sessionId', 'agentId', 'grantId', 'connectionId'];
  const values = fields.map(key => actor?.[key]);
  if (values.some(value => typeof value !== 'string' || !identifier.test(value))) {
    throw workerError('actor_invalid');
  }
  return JSON.stringify(values);
}

function checkKeys(input, required, optional = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      !required.every(key => Object.hasOwn(input, key)) ||
      Object.keys(input).some(key => !required.includes(key) && !optional.includes(key))) {
    throw workerError('request_invalid');
  }
}

export function normalizeWorkerRequest(input) {
  if (!actions.includes(input?.action)) throw workerError('action_invalid');
  if (input.action === 'capabilities') {
    checkKeys(input, ['action']);
    return { action:'capabilities' };
  }
  const base = ['action', 'workerId'];
  const { action, workerId } = input;
  if (typeof workerId !== 'string' || !jobIdentifier.test(workerId)) {
    throw workerError('id_invalid');
  }
  if (action === 'events') {
    checkKeys(input, base, ['after']);
    const after = input.after ?? 0;
    if (!Number.isSafeInteger(after) || after < 0) throw workerError('cursor_invalid');
    return { action, workerId, after };
  }
  if (action !== 'start') {
    checkKeys(input, base);
    return { action, workerId };
  }
  checkKeys(input, [...base, 'provider', 'model', 'prompt', 'timeoutMs'], ['context']);
  const { provider, model, prompt, context = '', timeoutMs } = input;
  if (!providers.includes(provider) ||
      typeof model !== 'string' || !identifier.test(model) ||
      typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 8000 ||
      typeof context !== 'string' || Buffer.byteLength(context) > 48000 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 10000 || timeoutMs > 90000) {
    throw workerError('request_invalid');
  }
  return { action, workerId, provider, model, prompt, context, timeoutMs };
}

export function workerRequestDigest(request) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

export function safeWorkerError(error) {
  return /^api_worker_[a-z0-9_]{1,80}$/.test(error?.message ?? '') ?
    error.message : 'api_worker_unavailable';
}

export const workerPilotEnabled = () => process.env.LIGHT_REMOTE_API_WORKER_PILOT === '1';

export function workerRef(value) {
  if (typeof value !== 'string' || !/^wrk_[0-9a-f]{48}$/.test(value)) throw workerError('ref_invalid');
  return value;
}
