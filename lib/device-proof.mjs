import crypto from 'node:crypto';

export function normalizeDeviceCapabilities(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const item = String(raw || '').trim().slice(0, 80);
    if (item && /^[A-Za-z0-9._:-]+$/.test(item) && !out.includes(item) && out.length < 64) out.push(item);
  }
  return out.sort();
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key]);
  return out;
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function devicePayloadSha256(value) {
  return crypto.createHash('sha256').update(canonicalJson(value ?? {})).digest('hex');
}

export function deviceHeartbeatMessage({ deviceId, timestamp, nonce, capabilities = [] }) {
  return canonicalJson({
    version: 1,
    deviceId: String(deviceId || ''),
    timestamp: Number(timestamp),
    nonce: String(nonce || ''),
    capabilities: normalizeDeviceCapabilities(capabilities)
  });
}

export function deviceChannelMessage({ deviceId, action, timestamp, nonce, payload = {} }) {
  return canonicalJson({
    version: 1,
    deviceId: String(deviceId || ''),
    action: String(action || ''),
    timestamp: Number(timestamp),
    nonce: String(nonce || ''),
    payloadSha256: devicePayloadSha256(payload)
  });
}


export function devicePolicyMessage({ deviceId, accountId, revision, approvedCapabilities = [], grantableCapabilities = [], policyProfile = 'default', updatedAt }) {
  return canonicalJson({
    version: 1,
    deviceId: String(deviceId || ''),
    accountId: String(accountId || ''),
    revision: Number(revision),
    approvedCapabilities: normalizeDeviceCapabilities(approvedCapabilities),
    grantableCapabilities: normalizeDeviceCapabilities(grantableCapabilities),
    policyProfile: String(policyProfile || 'default'),
    updatedAt: Number(updatedAt)
  });
}
