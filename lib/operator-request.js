const MAX_GET_PAYLOAD_CHARS = 6000;
const MAX_SCRIPT_BYTES = 1024 * 1024;

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validId(value, pattern, message) {
  const v = String(value || '').trim();
  if (!pattern.test(v)) throw httpError(message);
  return v;
}
function sid(value){ return validId(value,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_session_id'); }
function aid(value){ return validId(value,/^[A-Za-z0-9._:-]{16,128}$/,'invalid_agent_id'); }
function jobId(value){ return validId(value,/^[0-9a-f-]{20,}$/i,'invalid_job_id'); }

function decodeLegacyPayload(value) {
  const raw = String(value || '');
  if (!raw) throw httpError('missing_payload');
  if (raw.length > MAX_GET_PAYLOAD_CHARS) throw httpError('payload_too_large_use_post', 414);
  if (!/^[A-Za-z0-9_-]+$/.test(raw) || raw.length % 4 === 1) throw httpError('invalid_payload_encoding');
  let buffer;
  try { buffer = Buffer.from(raw, 'base64url'); } catch { throw httpError('invalid_payload_encoding'); }
  if (buffer.toString('base64url') !== raw) throw httpError('invalid_payload_encoding');
  try { return JSON.parse(buffer.toString('utf8')); } catch { throw httpError('invalid_payload_json'); }
}
function structuredPayload(req) {
  const value = req?.body?.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError('invalid_structured_payload');
  return value;
}

function payloadFor(req) {
  return req.method === 'POST' ? structuredPayload(req) : decodeLegacyPayload(req?.query?.p);
}

function normalizeExecPayload(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  if (typeof d.script !== 'string' || !d.script.trim()) throw httpError('invalid_script');
  if (Buffer.byteLength(d.script) > MAX_SCRIPT_BYTES) throw httpError('script_too_large', 413);
  const operationId = validId(d.operationId,/^[A-Za-z0-9._:-]{16,128}$/,'invalid_operation_id');
  return {
    action:'exec_batch', operationId, script:d.script, cwd:String(d.cwd || '/home/ubuntu'),
    timeoutMs:Math.max(1000,Math.min(Number(d.timeoutMs)||600000,7200000)),
    waitMs:Math.max(0,Math.min(Number.isFinite(Number(d.waitMs))?Number(d.waitMs):7000,7000)),
    sessionId:sid(d.sessionId), agentId:aid(d.agentId), note:String(d.note || '')
  };
}

function normalizeSessionOpenPayload(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const openId=validId(d.openId,/^[A-Za-z0-9._:-]{16,128}$/,'invalid_session_open_id');
  const leaseMs=d.leaseMs==null?undefined:Number(d.leaseMs);
  if (leaseMs!==undefined && !Number.isFinite(leaseMs)) throw httpError('invalid_session_lease');
  return { openId, agentId:aid(d.agentId), label:String(d.label||''), workspace:String(d.workspace||''), leaseMs };
}
function field(req, key, fallback = '') {
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const value = source[key];
  return value == null ? fallback : value;
}

module.exports = {
  MAX_GET_PAYLOAD_CHARS,
  aid,
  decodeLegacyPayload,
  field,
  jobId,
  normalizeExecPayload,
  normalizeSessionOpenPayload,
  payloadFor,
  sid
};
