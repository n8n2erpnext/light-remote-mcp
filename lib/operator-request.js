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
    action:'exec_batch', operationId, script:d.script, cwd:d.cwd==null?undefined:String(d.cwd),
    timeoutMs:Math.max(1000,Math.min(Number(d.timeoutMs)||600000,7200000)),
    waitMs:Math.max(0,Math.min(Number.isFinite(Number(d.waitMs))?Number(d.waitMs):7000,7000)),
    sessionId:sid(d.sessionId), agentId:aid(d.agentId), note:String(d.note || ''),
    nodeId:d.nodeId==null?undefined:validId(d.nodeId,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_node_id'),
    requiredCapabilities:cleanCapabilityList(Array.isArray(d.requiredCapabilities)&&d.requiredCapabilities.length?d.requiredCapabilities:['filesystem'],{required:true})
  };
}

function normalizeSessionOpenPayload(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const openId=validId(d.openId,/^[A-Za-z0-9._:-]{16,128}$/,'invalid_session_open_id');
  const leaseMs=d.leaseMs==null?undefined:Number(d.leaseMs);
  if (leaseMs!==undefined && !Number.isFinite(leaseMs)) throw httpError('invalid_session_lease');
  const leasePreset=d.leasePreset==null?undefined:String(d.leasePreset).trim().toLowerCase();
  if (leasePreset!==undefined && !/^[a-z0-9_-]{1,32}$/.test(leasePreset)) throw httpError('invalid_session_lease_preset');
  return { openId, agentId:aid(d.agentId), label:String(d.label||''), workspace:String(d.workspace||''), leaseMs, leasePreset, nodeId:d.nodeId==null?undefined:validId(d.nodeId,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_node_id') };
}

function cleanCapabilityList(value, { required = false } = {}) {
  if (!Array.isArray(value)) { if (required) throw httpError('device_capabilities_required'); return []; }
  const out=[];
  for (const raw of value) {
    const item=String(raw||'').trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(item)) throw httpError('invalid_device_capability');
    if (!out.includes(item) && out.length < 64) out.push(item);
  }
  if (required && !out.length) throw httpError('device_capabilities_required');
  return out.sort();
}
function enrollmentId(value) { return validId(value,/^enr_[A-Za-z0-9-]{20,80}$/,'invalid_enrollment_id'); }
function normalizeEnrollmentBegin(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const publicIdentityKey=String(d.publicIdentityKey||'').trim();
  if (publicIdentityKey.length < 40 || publicIdentityKey.length > 512 || !/^[A-Za-z0-9+/=]+$/.test(publicIdentityKey)) throw httpError('invalid_device_public_key');
  const policyProfile=String(d.policyProfile||'default').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(policyProfile)) throw httpError('invalid_policy_profile');
  return { publicIdentityKey, displayName:String(d.displayName||'').trim().slice(0,120), platform:String(d.platform||'unknown').trim().slice(0,40), architecture:String(d.architecture||'unknown').trim().slice(0,40), agentVersion:String(d.agentVersion||'unknown').trim().slice(0,40), fingerprintSummary:String(d.fingerprintSummary||'').trim().slice(0,200), capabilities:cleanCapabilityList(d.capabilities,{required:true}), policyProfile };
}
function normalizeEnrollmentPoll(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const pollToken=String(d.pollToken||'').trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(pollToken)) throw httpError('invalid_enrollment_poll_token');
  return { enrollmentId:enrollmentId(d.enrollmentId), pollToken };
}
function normalizeEnrollmentCancel(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  return { enrollmentId:validId(d.enrollmentId,/^enr_[0-9a-f-]{20,}$/i,'invalid_enrollment_id') };
}
function normalizeEnrollmentApprove(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const code=String(d.code||'').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(code)) throw httpError('invalid_device_code');
  const policyProfile=d.policyProfile==null?undefined:String(d.policyProfile).trim();
  if (policyProfile!==undefined && !/^[A-Za-z0-9._:-]{1,80}$/.test(policyProfile)) throw httpError('invalid_policy_profile');
  return { code, displayName:d.displayName==null?undefined:String(d.displayName).trim().slice(0,120), approvedCapabilities:Array.isArray(d.approvedCapabilities)?cleanCapabilityList(d.approvedCapabilities):undefined, policyProfile };
}
function normalizeDevicePolicy(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const deviceId=validId(d.deviceId,/^dev_[a-f0-9]{24}$/,'invalid_device_id');
  const policyProfile=String(d.policyProfile||'default').trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(policyProfile)) throw httpError('invalid_policy_profile');
  return { deviceId, policyProfile, approvedCapabilities:cleanCapabilityList(d.approvedCapabilities,{required:true}) };
}
function normalizeDeviceRevoke(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  return { deviceId:validId(d.deviceId,/^dev_[a-f0-9]{24}$/,'invalid_device_id'), reason:String(d.reason||'owner_revoked').trim().slice(0,120) };
}
function normalizeNodeDrain(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  if (typeof d.draining !== 'boolean') throw httpError('invalid_node_drain_state');
  return { nodeId:validId(d.nodeId,/^[A-Za-z0-9._:-]{1,128}$/,'invalid_node_id'), draining:d.draining };
}
function normalizeDeviceHeartbeat(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw httpError('invalid_payload');
  const timestamp=Number(d.timestamp);
  if (!Number.isSafeInteger(timestamp)) throw httpError('invalid_device_timestamp');
  const nonce=String(d.nonce||'').trim(), signature=String(d.signature||'').trim();
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw httpError('invalid_device_nonce');
  if (!/^[A-Za-z0-9_-]{40,256}$/.test(signature)) throw httpError('invalid_device_signature');
  return { deviceId:validId(d.deviceId,/^dev_[a-f0-9]{24}$/,'invalid_device_id'), timestamp, nonce, signature, capabilities:cleanCapabilityList(d.capabilities), policyRevision:Math.max(0,Number(d.policyRevision)||0) };
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
  normalizeDeviceHeartbeat,
  normalizeDevicePolicy,
  normalizeDeviceRevoke,
  normalizeEnrollmentApprove,
  normalizeEnrollmentCancel,
  normalizeEnrollmentBegin,
  normalizeEnrollmentPoll,
  normalizeNodeDrain,
  normalizeExecPayload,
  normalizeSessionOpenPayload,
  payloadFor,
  sid
};
