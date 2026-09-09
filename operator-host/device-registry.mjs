import fs from 'node:fs';
import path from 'node:path';

export class DeviceError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
function boundedText(value, max) { return String(value || '').slice(0, max); }
function cleanCapabilities(value) {
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const v = boundedText(item, 80).trim();
    if (v && !out.includes(v) && out.length < 64) out.push(v);
  }
  return out;
}

export class DeviceRegistry {
  constructor({ stateFile = null, presenceTtlMs = 90_000, now = () => Date.now(), emit = () => {} } = {}) {
    if (!Number.isFinite(presenceTtlMs) || presenceTtlMs < 1000) throw new DeviceError('invalid_presence_ttl');
    this.stateFile = stateFile;
    this.presenceTtlMs = Math.round(presenceTtlMs);
    this.now = now;
    this.emit = emit;
    this.devices = new Map();
    this.loadError = null;
    this._load();
  }

  _validId(value) { return ID_RE.test(String(value || '')); }
  _requireId(value, name) {
    const v = String(value || '').trim();
    if (!this._validId(v)) throw new DeviceError(`invalid_${name}`);
    return v;
  }
  _state(device, now = this.now()) {
    if (device.revokedAt) return 'revoked';
    if (device.offlineAt) return 'offline';
    return now - device.lastSeenAt <= this.presenceTtlMs ? 'online' : 'offline';
  }

  _view(device, { activeSessionsForNode = () => 0, now = this.now() } = {}) {
    return {
      accountId: device.accountId,
      deviceId: device.deviceId,
      nodeId: device.nodeId,
      displayName: device.displayName,
      platform: device.platform,
      architecture: device.architecture,
      agentVersion: device.agentVersion,
      state: this._state(device, now),
      firstSeenAt: device.firstSeenAt,
      lastSeenAt: device.lastSeenAt,
      offlineAt: device.offlineAt,
      revokedAt: device.revokedAt || null,
      publicIdentityKey: device.publicIdentityKey,
      capabilities: [...device.capabilities],
      policyProfile: device.policyProfile,
      activeSessions: Math.max(0, Number(activeSessionsForNode(device.nodeId)) || 0),
      presenceTtlMs: this.presenceTtlMs
    };
  }

  _persist() {
    if (!this.stateFile) return;
    const dir = path.dirname(this.stateFile);
    fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
    const payload = { schemaVersion: 1, devices: [...this.devices.values()] };
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.stateFile);
  }
  _load() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (data?.schemaVersion !== 1 || !Array.isArray(data.devices)) throw new Error('invalid_schema');
      for (const raw of data.devices) {
        const accountId = this._requireId(raw.accountId, 'account_id');
        const deviceId = this._requireId(raw.deviceId, 'device_id');
        const nodeId = this._requireId(raw.nodeId, 'node_id');
        const firstSeenAt = Number(raw.firstSeenAt);
        const lastSeenAt = Number(raw.lastSeenAt);
        if (!Number.isFinite(firstSeenAt) || !Number.isFinite(lastSeenAt)) throw new Error('invalid_timestamps');
        this.devices.set(deviceId, {
          accountId, deviceId, nodeId,
          displayName: boundedText(raw.displayName || deviceId, 120),
          platform: boundedText(raw.platform || 'unknown', 40),
          architecture: boundedText(raw.architecture || 'unknown', 40),
          agentVersion: boundedText(raw.agentVersion || 'unknown', 40),
          firstSeenAt, lastSeenAt,
          offlineAt: Number.isFinite(Number(raw.offlineAt)) ? Number(raw.offlineAt) : null,
          revokedAt: Number.isFinite(Number(raw.revokedAt)) ? Number(raw.revokedAt) : null,
          publicIdentityKey: raw.publicIdentityKey ? boundedText(raw.publicIdentityKey, 4096) : null,
          capabilities: cleanCapabilities(raw.capabilities),
          policyProfile: boundedText(raw.policyProfile || 'default', 120)
        });
      }
    } catch (error) {
      this.devices.clear();
      this.loadError = error?.message || 'invalid_device_state';
    }
  }

  register(input = {}) {
    const now = this.now();
    const accountId = this._requireId(input.accountId, 'account_id');
    const deviceId = this._requireId(input.deviceId, 'device_id');
    const nodeId = this._requireId(input.nodeId, 'node_id');
    const prior = this.devices.get(deviceId);
    const nodeOwner=[...this.devices.values()].find(row=>row.nodeId===nodeId && row.deviceId!==deviceId);
    if (nodeOwner) throw new DeviceError('node_identity_conflict',409);
    if (prior && (prior.accountId !== accountId || prior.nodeId !== nodeId)) throw new DeviceError('device_identity_conflict', 409);
    const wasOffline = prior ? this._state(prior, now) === 'offline' : false;
    const device = {
      accountId, deviceId, nodeId,
      displayName: boundedText(input.displayName || prior?.displayName || deviceId, 120),
      platform: boundedText(input.platform || prior?.platform || 'unknown', 40),
      architecture: boundedText(input.architecture || prior?.architecture || 'unknown', 40),
      agentVersion: boundedText(input.agentVersion || prior?.agentVersion || 'unknown', 40),
      firstSeenAt: prior?.firstSeenAt || now,
      lastSeenAt: now,
      offlineAt: null,
      revokedAt: null,
      publicIdentityKey: input.publicIdentityKey ? boundedText(input.publicIdentityKey, 4096) : (prior?.publicIdentityKey || null),
      capabilities: cleanCapabilities(input.capabilities?.length ? input.capabilities : prior?.capabilities),
      policyProfile: boundedText(input.policyProfile || prior?.policyProfile || 'default', 120)
    };
    this.devices.set(deviceId, device);
    this._persist();
    this.emit({
      type: prior ? (wasOffline ? 'device_online' : 'device_updated') : 'device_registered',
      accountId, deviceId, nodeId, status: 'online', displayName: device.displayName,
      platform: device.platform, architecture: device.architecture, agentVersion: device.agentVersion
    });
    return this._view(device);
  }

  enroll(input = {}) {
    const now = this.now();
    const accountId = this._requireId(input.accountId, 'account_id');
    const deviceId = this._requireId(input.deviceId, 'device_id');
    const nodeId = this._requireId(input.nodeId || deviceId, 'node_id');
    const prior = this.devices.get(deviceId);
    const nodeOwner=[...this.devices.values()].find(row=>row.nodeId===nodeId && row.deviceId!==deviceId);
    if (nodeOwner) throw new DeviceError('node_identity_conflict',409);
    if (prior && (prior.accountId !== accountId || prior.publicIdentityKey !== input.publicIdentityKey)) throw new DeviceError('device_identity_conflict', 409);
    const device = {
      accountId, deviceId, nodeId,
      displayName: boundedText(input.displayName || prior?.displayName || deviceId, 120),
      platform: boundedText(input.platform || prior?.platform || 'unknown', 40),
      architecture: boundedText(input.architecture || prior?.architecture || 'unknown', 40),
      agentVersion: boundedText(input.agentVersion || prior?.agentVersion || 'unknown', 40),
      firstSeenAt: prior?.firstSeenAt || now, lastSeenAt: prior?.lastSeenAt || now, offlineAt: now, revokedAt: null,
      publicIdentityKey: boundedText(input.publicIdentityKey || prior?.publicIdentityKey || '', 4096) || null,
      capabilities: cleanCapabilities(input.capabilities),
      policyProfile: boundedText(input.policyProfile || prior?.policyProfile || 'default', 120)
    };
    this.devices.set(deviceId, device); this._persist();
    this.emit({ type:'device_enrolled', accountId, deviceId, nodeId, status:'offline', displayName:device.displayName, platform:device.platform, architecture:device.architecture, agentVersion:device.agentVersion });
    return this._view(device, { now });
  }

  heartbeat(deviceId, options = {}) {
    const device = this.devices.get(String(deviceId || ''));
    if (!device) throw new DeviceError('device_not_found', 404);
    if (device.revokedAt) throw new DeviceError('device_revoked', 403);
    const now = this.now();
    const wasOffline = this._state(device, now) === 'offline';
    device.lastSeenAt = now;
    device.offlineAt = null;
    let capabilitiesChanged = false;
    if (Array.isArray(options.capabilities)) {
      const next = cleanCapabilities(options.capabilities);
      capabilitiesChanged = JSON.stringify(next) !== JSON.stringify(device.capabilities);
      device.capabilities = next;
    }
    if (wasOffline || capabilitiesChanged) this._persist();
    if (wasOffline) this.emit({ type:'device_online', accountId:device.accountId, deviceId:device.deviceId, nodeId:device.nodeId, status:'online' });
    return this._view(device, { now });
  }
  revoke(deviceId, reason = 'owner_revoked') {
    const device = this.devices.get(String(deviceId || ''));
    if (!device) throw new DeviceError('device_not_found', 404);
    if (!device.revokedAt) {
      device.revokedAt = this.now(); device.offlineAt = device.revokedAt; this._persist();
      this.emit({ type:'device_revoked', accountId:device.accountId, deviceId:device.deviceId, nodeId:device.nodeId, status:'revoked', reason:boundedText(reason,80) });
    }
    return this._view(device);
  }

  markOffline(deviceId, reason = 'agent_stopped') {
    const device = this.devices.get(String(deviceId || ''));
    if (!device) throw new DeviceError('device_not_found', 404);
    if (!device.offlineAt) {
      device.offlineAt = this.now();
      this._persist();
      this.emit({ type:'device_offline', accountId:device.accountId, deviceId:device.deviceId, nodeId:device.nodeId, status:'offline', reason:boundedText(reason, 80) });
    }
    return this._view(device);
  }

  get(deviceId, options = {}) {
    const device = this.devices.get(String(deviceId || ''));
    if (!device) throw new DeviceError('device_not_found', 404);
    return this._view(device, options);
  }

  getByNodeId(nodeId, options = {}) {
    const nid=this._requireId(nodeId,'node_id');
    const matches=[...this.devices.values()].filter(device=>device.nodeId===nid);
    if (!matches.length) throw new DeviceError('node_not_found',404);
    if (matches.length>1) throw new DeviceError('node_identity_conflict',409);
    return this._view(matches[0],options);
  }

  list(options = {}) {
    return [...this.devices.values()]
      .map(device => this._view(device, options))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.deviceId.localeCompare(b.deviceId));
  }
}
