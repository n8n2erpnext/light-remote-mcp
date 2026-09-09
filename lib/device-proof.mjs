export function normalizeDeviceCapabilities(value) {
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const item = String(raw || '').trim().slice(0, 80);
    if (item && /^[A-Za-z0-9._:-]+$/.test(item) && !out.includes(item) && out.length < 64) out.push(item);
  }
  return out.sort();
}

export function deviceHeartbeatMessage({ deviceId, timestamp, nonce, capabilities = [] }) {
  return JSON.stringify({
    version: 1,
    deviceId: String(deviceId || ''),
    timestamp: Number(timestamp),
    nonce: String(nonce || ''),
    capabilities: normalizeDeviceCapabilities(capabilities)
  });
}
