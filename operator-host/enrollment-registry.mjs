import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deviceChannelMessage, deviceHeartbeatMessage, devicePolicyMessage, normalizeDeviceCapabilities } from './device-proof.mjs';

export class EnrollmentError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const POLICY_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function bounded(value, max) { return String(value || '').trim().slice(0, max); }
const cleanCapabilities = normalizeDeviceCapabilities;
function safeEqualHex(a, b) {
  const aa = Buffer.from(String(a || ''), 'hex');
  const bb = Buffer.from(String(b || ''), 'hex');
  return aa.length > 0 && aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function codeHash(code, salt) { return sha256(`${salt}:${String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')}`); }
function tokenHash(token) { return sha256(String(token || '')); }
function randomCode() {
  let raw = '';
  for (let i = 0; i < 8; i++) raw += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
function parseEd25519PublicKey(value) {
  let der;
  try { der = Buffer.from(String(value || ''), 'base64'); } catch { throw new EnrollmentError('invalid_device_public_key'); }
  if (der.length < 32 || der.length > 256) throw new EnrollmentError('invalid_device_public_key');
  let key;
  try { key = crypto.createPublicKey({ key: der, format:'der', type:'spki' }); } catch { throw new EnrollmentError('invalid_device_public_key'); }
  if (key.asymmetricKeyType !== 'ed25519') throw new EnrollmentError('device_key_must_be_ed25519');
  const canonical = key.export({ format:'der', type:'spki' });
  return { key, der:canonical, encoded:Buffer.from(canonical).toString('base64'), fingerprint:sha256(canonical) };
}
function deviceIdForFingerprint(fingerprint) { return `dev_${fingerprint.slice(0, 24)}`; }
function certificateBody(binding) {
  return {
    version: 1,
    certificateId: binding.certificateId,
    deviceId: binding.deviceId,
    accountId: binding.accountId,
    publicKeySha256: binding.publicKeySha256,
    publicIdentityKey: binding.publicIdentityKey,
    approvedCapabilities: [...binding.approvedCapabilities],
    policyProfile: binding.policyProfile,
    issuedAt: binding.issuedAt,
    notAfter: binding.notAfter
  };
}
function canonicalCertificate(binding) { return JSON.stringify(certificateBody(binding)); }

export class EnrollmentRegistry {
  constructor({ stateFile = null, signerFile = null, activationBaseUrl = 'https://wall.dashboard.thaiduy.store/enroll', ttlMs = 10 * 60 * 1000, certificateTtlMs = 365 * 24 * 60 * 60 * 1000, maxPending = 50, now = () => Date.now(), emit = () => {} } = {}) {
    if (!Number.isFinite(ttlMs) || ttlMs < 60_000 || ttlMs > 60 * 60 * 1000) throw new EnrollmentError('invalid_enrollment_ttl');
    this.stateFile = stateFile;
    this.signerFile = signerFile;
    this.activationBaseUrl = activationBaseUrl;
    this.ttlMs = Math.round(ttlMs);
    this.certificateTtlMs = Math.round(certificateTtlMs);
    this.maxPending = Math.max(1, Math.min(Number(maxPending) || 50, 500));
    this.now = now;
    this.emit = emit;
    this.pending = new Map();
    this.bindings = new Map();
    this.nonces = new Map();
    this.loadError = null;
    this.signer = this._loadOrCreateSigner();
    this._load();
  }

  _loadOrCreateSigner() {
    if (!this.signerFile) {
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      return { publicKey, privateKey, publicEncoded:publicKey.export({format:'der',type:'spki'}).toString('base64') };
    }
    try {
      if (fs.existsSync(this.signerFile)) {
        const raw = JSON.parse(fs.readFileSync(this.signerFile, 'utf8'));
        const privateKey = crypto.createPrivateKey({ key:Buffer.from(raw.privateKey,'base64'), format:'der', type:'pkcs8' });
        const publicKey = crypto.createPublicKey({ key:Buffer.from(raw.publicKey,'base64'), format:'der', type:'spki' });
        if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') throw new Error('invalid_signer_type');
        return { privateKey, publicKey, publicEncoded:raw.publicKey };
      }
      const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
      const dir = path.dirname(this.signerFile); fs.mkdirSync(dir,{recursive:true,mode:0o750});
      const payload = { schemaVersion:1, algorithm:'Ed25519', privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'), publicKey:publicKey.export({format:'der',type:'spki'}).toString('base64') };
      fs.writeFileSync(this.signerFile, `${JSON.stringify(payload,null,2)}\n`, {mode:0o600}); fs.chmodSync(this.signerFile,0o600);
      return { privateKey, publicKey, publicEncoded:payload.publicKey };
    } catch (error) { throw new EnrollmentError(`enrollment_signer_error:${error?.message || 'unknown'}`, 500); }
  }

  _persist() {
    if (!this.stateFile) return;
    const dir = path.dirname(this.stateFile); fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const payload = { schemaVersion:1, pending:[...this.pending.values()], bindings:[...this.bindings.values()] };
    const tmp = `${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(payload,null,2)}\n`, {mode:0o600}); fs.chmodSync(tmp,0o600); fs.renameSync(tmp,this.stateFile);
  }
  _load() {
    if (!this.stateFile || !fs.existsSync(this.stateFile)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      if (data?.schemaVersion !== 1 || !Array.isArray(data.pending) || !Array.isArray(data.bindings)) throw new Error('invalid_schema');
      for (const row of data.pending) if (row?.enrollmentId) this.pending.set(row.enrollmentId,row);
      let migrated=false;
      for (const row of data.bindings) if (row?.deviceId) {
        const grantable=cleanCapabilities(row.grantableCapabilities || row.requestedCapabilities || row.approvedCapabilities || []);
        const approved=cleanCapabilities(row.approvedCapabilities || []);
        const policyRevision=Math.max(1,Number(row.policyRevision)||1);
        const policyUpdatedAt=Number(row.policyUpdatedAt)||Number(row.issuedAt)||this.now();
        if(JSON.stringify(row.grantableCapabilities)!==JSON.stringify(grantable)||JSON.stringify(row.approvedCapabilities)!==JSON.stringify(approved)||row.policyRevision!==policyRevision||row.policyUpdatedAt!==policyUpdatedAt)migrated=true;
        row.grantableCapabilities=grantable; row.approvedCapabilities=approved; row.policyRevision=policyRevision; row.policyUpdatedAt=policyUpdatedAt;
        this.bindings.set(row.deviceId,row);
      }
      this._prune(false);
      if(migrated)this._persist();
    } catch (error) { this.pending.clear(); this.bindings.clear(); this.loadError = error?.message || 'invalid_enrollment_state'; }
  }
  _prune(persist = true) {
    const now = this.now(); let changed = false;
    for (const [id,row] of this.pending) if (row.expiresAt <= now && row.state === 'pending') { row.state='expired'; row.expiredAt=now; changed=true; }
    for (const [nonce,exp] of this.nonces) if (exp <= now) this.nonces.delete(nonce);
    if (changed && persist) this._persist();
  }
  signerInfo() { return { algorithm:'Ed25519', publicKey:this.signer.publicEncoded, publicKeySha256:sha256(Buffer.from(this.signer.publicEncoded,'base64')) }; }

  begin(input = {}) {
    this._prune();
    const publicKey = parseEd25519PublicKey(input.publicIdentityKey);
    const existing = [...this.pending.values()].find(row => row.publicKeySha256 === publicKey.fingerprint && row.state === 'pending' && row.expiresAt > this.now());
    if (existing) { existing.state='replaced'; existing.replacedAt=this.now(); }
    const livePending = [...this.pending.values()].filter(row => row.state === 'pending' && row.expiresAt > this.now()).length;
    if (livePending >= this.maxPending) throw new EnrollmentError('enrollment_capacity_reached',429);
    const sourceHash = bounded(input.sourceHash || 'unknown', 64);
    const sourcePending = [...this.pending.values()].filter(row => row.state === 'pending' && row.expiresAt > this.now() && row.sourceHash === sourceHash).length;
    if (sourcePending >= 3) throw new EnrollmentError('enrollment_source_limit',429);
    const capabilities = cleanCapabilities(input.capabilities);
    if (!capabilities.length) throw new EnrollmentError('device_capabilities_required');
    const displayName = bounded(input.displayName || 'Unnamed device',120);
    const platform = bounded(input.platform || 'unknown',40);
    const architecture = bounded(input.architecture || 'unknown',40);
    const agentVersion = bounded(input.agentVersion || 'unknown',40);
    const fingerprintSummary = bounded(input.fingerprintSummary || `${platform}/${architecture}`,200);
    const requestedPolicy = bounded(input.policyProfile || 'default',80) || 'default';
    if (!POLICY_RE.test(requestedPolicy)) throw new EnrollmentError('invalid_policy_profile');
    const now = this.now(), enrollmentId = `enr_${crypto.randomUUID()}`, pollToken = crypto.randomBytes(32).toString('base64url'), code = randomCode(), codeSalt = crypto.randomBytes(16).toString('hex');
    const row = { enrollmentId, state:'pending', createdAt:now, expiresAt:now+this.ttlMs, pollTokenHash:tokenHash(pollToken), codeSalt, codeHash:codeHash(code,codeSalt), publicKeySha256:publicKey.fingerprint, publicIdentityKey:publicKey.encoded, requestedCapabilities:capabilities, requestedPolicy, displayName, platform, architecture, agentVersion, fingerprintSummary, sourceHash };
    this.pending.set(enrollmentId,row); this._persist();
    this.emit({ type:'device_enrollment_started', enrollmentId, status:'pending', publicKeySha256:publicKey.fingerprint, displayName, platform, architecture });
    return { enrollmentId, deviceCode:code, pollToken, activationUrl:`${this.activationBaseUrl}?id=${encodeURIComponent(enrollmentId)}`, expiresAt:row.expiresAt, expiresInSeconds:Math.floor(this.ttlMs/1000), fingerprintSummary, requestedCapabilities:capabilities, requestedPolicy };
  }

  listPending() {
    this._prune();
    return [...this.pending.values()].filter(row => row.state === 'pending' && row.expiresAt > this.now()).map(row => ({ enrollmentId:row.enrollmentId, state:row.state, createdAt:row.createdAt, expiresAt:row.expiresAt, displayName:row.displayName, platform:row.platform, architecture:row.architecture, agentVersion:row.agentVersion, fingerprintSummary:row.fingerprintSummary, publicKeySha256:row.publicKeySha256, requestedCapabilities:[...row.requestedCapabilities], requestedPolicy:row.requestedPolicy }));
  }

  approve(input = {}) {
    this._prune();
    const normalizedCode = String(input.code || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if (normalizedCode.length !== 8) throw new EnrollmentError('invalid_device_code');
    const row = [...this.pending.values()].find(candidate => candidate.state === 'pending' && candidate.expiresAt > this.now() && safeEqualHex(candidate.codeHash,codeHash(normalizedCode,candidate.codeSalt)));
    if (!row) throw new EnrollmentError('device_code_not_found_or_used',404);
    const accountId = bounded(input.accountId,128);
    if (!ID_RE.test(accountId)) throw new EnrollmentError('invalid_account_id');
    const approvedCapabilities = cleanCapabilities(Array.isArray(input.approvedCapabilities) ? input.approvedCapabilities : row.requestedCapabilities);
    if (!approvedCapabilities.length || approvedCapabilities.some(item => !row.requestedCapabilities.includes(item))) throw new EnrollmentError('approved_capability_not_requested');
    const policyProfile = bounded(input.policyProfile || row.requestedPolicy || 'default',80);
    if (!POLICY_RE.test(policyProfile)) throw new EnrollmentError('invalid_policy_profile');
    const now = this.now(), deviceId=deviceIdForFingerprint(row.publicKeySha256), certificateId=`cert_${crypto.randomUUID()}`;
    const binding = { deviceId, accountId, publicKeySha256:row.publicKeySha256, publicIdentityKey:row.publicIdentityKey, grantableCapabilities:[...row.requestedCapabilities], approvedCapabilities, policyProfile, policyRevision:1, policyUpdatedAt:now, displayName:bounded(input.displayName || row.displayName,120), platform:row.platform, architecture:row.architecture, agentVersion:row.agentVersion, fingerprintSummary:row.fingerprintSummary, certificateId, issuedAt:now, notAfter:now+this.certificateTtlMs };
    binding.certificate = certificateBody(binding);
    binding.certificateSignature = crypto.sign(null, Buffer.from(canonicalCertificate(binding)), this.signer.privateKey).toString('base64url');
    this.bindings.set(deviceId,binding);
    row.state='approved'; row.approvedAt=now; row.deviceId=deviceId; row.accountId=accountId; row.codeHash=''; row.codeSalt=''; row.certificateId=certificateId;
    this._persist();
    this.emit({ type:'device_enrollment_approved', enrollmentId:row.enrollmentId, deviceId, accountId, status:'approved', policyProfile, capabilities:approvedCapabilities });
    return { enrollmentId:row.enrollmentId, deviceId, accountId, approvedCapabilities, policyProfile, certificate:binding.certificate, certificateSignature:binding.certificateSignature, signer:this.signerInfo() };
  }

  poll(input = {}) {
    this._prune();
    const row = this.pending.get(String(input.enrollmentId || ''));
    if (!row) throw new EnrollmentError('enrollment_not_found',404);
    if (!safeEqualHex(row.pollTokenHash, tokenHash(input.pollToken))) throw new EnrollmentError('invalid_enrollment_poll_token',401);
    if (row.state === 'expired' || row.expiresAt <= this.now()) return { enrollmentId:row.enrollmentId, state:'expired' };
    if (row.state === 'pending' || row.state === 'replaced') return { enrollmentId:row.enrollmentId, state:row.state, expiresAt:row.expiresAt };
    if (row.state === 'approved' || row.state === 'claimed') {
      const binding=this.bindings.get(row.deviceId); if (!binding) throw new EnrollmentError('device_binding_missing',500);
      row.state='claimed'; row.claimedAt=row.claimedAt || this.now(); this._persist();
      return { enrollmentId:row.enrollmentId, state:'approved', deviceId:binding.deviceId, accountId:binding.accountId, approvedCapabilities:[...binding.approvedCapabilities], policyProfile:binding.policyProfile, certificate:binding.certificate, certificateSignature:binding.certificateSignature, signer:this.signerInfo() };
    }
    return { enrollmentId:row.enrollmentId, state:row.state };
  }

  cancel(input = {}) {
    this._prune();
    const enrollmentId=String(input.enrollmentId||'');
    const row=this.pending.get(enrollmentId);
    if (!row) throw new EnrollmentError('enrollment_not_found',404);
    if (!['pending','replaced'].includes(row.state)) throw new EnrollmentError('enrollment_not_cancellable',409);
    row.state='cancelled'; row.cancelledAt=this.now(); row.codeHash=''; row.codeSalt=''; this._persist();
    this.emit({type:'device_enrollment_cancelled',enrollmentId,status:'cancelled'});
    return { enrollmentId, state:'cancelled', cancelledAt:row.cancelledAt };
  }

  policyView(deviceId) {
    const row=this.binding(deviceId);
    return { deviceId:row.deviceId, accountId:row.accountId, policyProfile:row.policyProfile, policyRevision:Math.max(1,Number(row.policyRevision)||1), policyUpdatedAt:Number(row.policyUpdatedAt)||row.issuedAt, grantableCapabilities:[...(row.grantableCapabilities||row.approvedCapabilities||[])], approvedCapabilities:[...row.approvedCapabilities] };
  }
  policyEnvelope(deviceId) {
    const policy=this.policyView(deviceId);
    const signature=crypto.sign(null,Buffer.from(devicePolicyMessage({deviceId:policy.deviceId,accountId:policy.accountId,revision:policy.policyRevision,approvedCapabilities:policy.approvedCapabilities,grantableCapabilities:policy.grantableCapabilities,policyProfile:policy.policyProfile,updatedAt:policy.policyUpdatedAt})),this.signer.privateKey).toString('base64url');
    return { policy, signature, signer:this.signerInfo() };
  }
  updatePolicy(input = {}) {
    const row=this.binding(input.deviceId);
    const accountId=String(input.accountId||'');
    if(row.accountId!==accountId) throw new EnrollmentError('device_account_mismatch',403);
    const grantable=cleanCapabilities(row.grantableCapabilities || row.approvedCapabilities || []);
    const approved=cleanCapabilities(Array.isArray(input.approvedCapabilities)?input.approvedCapabilities:row.approvedCapabilities);
    if(!approved.length) throw new EnrollmentError('approved_capabilities_required');
    if(approved.some(item=>!grantable.includes(item))) throw new EnrollmentError('approved_capability_not_grantable',403);
    const profile=bounded(input.policyProfile ?? row.policyProfile ?? 'default',80) || 'default';
    if(!POLICY_RE.test(profile)) throw new EnrollmentError('invalid_policy_profile');
    const same=profile===row.policyProfile && approved.length===row.approvedCapabilities.length && approved.every((item,index)=>item===row.approvedCapabilities[index]);
    if(!same){row.approvedCapabilities=approved;row.policyProfile=profile;row.policyRevision=Math.max(1,Number(row.policyRevision)||1)+1;row.policyUpdatedAt=this.now();this._persist();this.emit({type:'device_policy_updated',deviceId:row.deviceId,accountId:row.accountId,status:'updated',policyProfile:profile,policyRevision:row.policyRevision,capabilities:approved});}
    return this.policyView(row.deviceId);
  }
  binding(deviceId, { allowRevoked = false } = {}) { const row=this.bindings.get(String(deviceId||'')); if (!row) throw new EnrollmentError('device_binding_not_found',404); if (row.revokedAt && !allowRevoked) throw new EnrollmentError('device_revoked',403); return row; }
  revoke(input = {}) { const row=this.binding(input.deviceId,{allowRevoked:true}); const accountId=String(input.accountId||''); if (row.accountId!==accountId) throw new EnrollmentError('device_account_mismatch',403); if (!row.revokedAt) { row.revokedAt=this.now(); row.revokeReason=bounded(input.reason||'owner_revoked',120); this._persist(); this.emit({type:'device_revoked',deviceId:row.deviceId,accountId:row.accountId,status:'revoked',reason:row.revokeReason}); } return { deviceId:row.deviceId, accountId:row.accountId, revokedAt:row.revokedAt, reason:row.revokeReason }; }
  verifyChannel(input = {}, action = '', payload = {}) {
    this._prune();
    const binding=this.binding(input.deviceId);
    const timestamp=Number(input.timestamp), nonce=String(input.nonce||''), signature=String(input.signature||''), channelAction=String(action||'');
    if (!/^[a-z0-9._:-]{1,64}$/.test(channelAction)) throw new EnrollmentError('invalid_device_channel_action');
    if (!Number.isSafeInteger(timestamp) || Math.abs(this.now()-timestamp) > 60_000) throw new EnrollmentError('device_proof_expired',401);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new EnrollmentError('invalid_device_nonce');
    const replayKey=`channel:${binding.deviceId}:${nonce}`;
    if (this.nonces.has(replayKey)) throw new EnrollmentError('device_proof_replay',409);
    const message=deviceChannelMessage({deviceId:binding.deviceId,action:channelAction,timestamp,nonce,payload});
    let ok=false;
    try { const key=crypto.createPublicKey({key:Buffer.from(binding.publicIdentityKey,'base64'),format:'der',type:'spki'}); ok=crypto.verify(null,Buffer.from(message),key,Buffer.from(signature,'base64url')); } catch { ok=false; }
    if (!ok) throw new EnrollmentError('invalid_device_proof',401);
    this.nonces.set(replayKey,this.now()+120_000);
    return { binding, proof:{timestamp,nonce,action:channelAction} };
  }

  verifyHeartbeat(input = {}) {
    this._prune();
    const binding=this.binding(input.deviceId);
    const timestamp=Number(input.timestamp), nonce=String(input.nonce||''), signature=String(input.signature||'');
    if (!Number.isSafeInteger(timestamp) || Math.abs(this.now()-timestamp) > 60_000) throw new EnrollmentError('device_proof_expired',401);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new EnrollmentError('invalid_device_nonce');
    const replayKey=`${binding.deviceId}:${nonce}`;
    if (this.nonces.has(replayKey)) throw new EnrollmentError('device_proof_replay',409);
    const reportedCapabilities=cleanCapabilities(input.capabilities);
    const message=deviceHeartbeatMessage({ deviceId:binding.deviceId, timestamp, nonce, capabilities:reportedCapabilities });
    let ok=false;
    try { const key=crypto.createPublicKey({key:Buffer.from(binding.publicIdentityKey,'base64'),format:'der',type:'spki'}); ok=crypto.verify(null,Buffer.from(message),key,Buffer.from(signature,'base64url')); } catch { ok=false; }
    if (!ok) throw new EnrollmentError('invalid_device_proof',401);
    const currentRevision=Math.max(1,Number(binding.policyRevision)||1), stale=currentRevision>1 && Math.max(0,Number(input.policyRevision)||0)<currentRevision;
    const extras=reportedCapabilities.filter(item=>!binding.approvedCapabilities.includes(item));
    if(extras.length&&!stale)throw new EnrollmentError('device_capability_escalation',403);
    const effectiveCapabilities=reportedCapabilities.filter(item=>binding.approvedCapabilities.includes(item));
    if(!effectiveCapabilities.length)throw new EnrollmentError('device_capabilities_required');
    this.nonces.set(replayKey,this.now()+120_000);
    return { binding, effectiveCapabilities, reportedPolicyRevision:Math.max(0,Number(input.policyRevision)||0), proof:{timestamp,nonce} };
  }
}
