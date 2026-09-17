import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { decryptEnvelope as decryptSealedEnvelope } from './crypto.mjs';
import { spawn } from 'node:child_process';
import { SessionRegistry, SessionError, SESSION_GRACE_PRESETS } from './session-manager.mjs';
import { DeviceRegistry, DeviceError } from './device-registry.mjs';
import { EnrollmentRegistry, EnrollmentError } from './enrollment-registry.mjs';
import { FleetRouter, FleetError } from './fleet-router.mjs';
import { DeviceConnectionRegistry, DeviceConnectionError, DEFAULT_PLAN_CONNECTION_CAPS } from './device-connection-registry.mjs';
import { DeviceAccessGrantRegistry, DeviceAccessGrantError } from './device-access-grant-registry.mjs';
import { DevicePairingRegistry, DevicePairingRegistryError } from './device-pairing-registry.mjs';
import { AgentClientRegistry, AgentClientRegistryError } from './agent-client-registry.mjs';
import { AccountRegistry, AccountError } from './account-registry.mjs';
import { UsageRegistry } from './usage-registry.mjs';
import { LicenseKeyRegistry, LicenseKeyError } from './license-key-registry.mjs';
import { FleetAuthorityRegistry, FleetAuthorityError } from './fleet-authority-registry.mjs';
import { loadOrCreateHostDeviceIdentity, ensureHostCompanionState } from './host-device-identity.mjs';
import { executeNativeFs, filesystemPolicy } from '../lib/native-fs.mjs';
import { NativeProcessRegistry } from '../lib/native-process.mjs';
import { NativeTerminalRegistry } from '../lib/native-terminal.mjs';
import { NativeSearchRegistry } from '../lib/native-search.mjs';
import { LightScpRegistry } from '../lib/light-scp-registry.mjs';
import { normalizeUpdateReport } from '../lib/update-contract.mjs';
import { clientCompatibility } from '../lib/version-compat.mjs';
import { runtimeVersion } from '../lib/runtime-version.mjs';
import { createPlatformAdapter } from '../device-agent/platform-adapters/index.mjs';
import { handleAccountRoutes } from './executor-routes-account.mjs';
import { handleDeviceChannelRoutes } from './executor-routes-device-channel.mjs';
import { handleRuntimeRoutes } from './executor-routes-runtime.mjs';

const SOCKET_PATH = process.env.OPERATOR_SOCKET || '/run/gpt-vps-operator/operator.sock';
const KEY_FILE = process.env.OPERATOR_KEY_FILE || '/home/ubuntu/.config/gpt-vps-operator/operator.private.json';
const LOG_DIR = process.env.OPERATOR_LOG_DIR || '/var/log/gpt-vps-operator';
const LOG_FILE = path.join(LOG_DIR, 'operations.jsonl');
const STATE_DIR = process.env.OPERATOR_STATE_DIR || '/var/lib/gpt-vps-operator';
const DEVICE_STATE_FILE = path.join(STATE_DIR, 'devices.json');
const ENROLLMENT_STATE_FILE = path.join(STATE_DIR, 'enrollments.json');
const ENROLLMENT_SIGNER_FILE = path.join(STATE_DIR, 'enrollment-signer.json');
const HOST_DEVICE_IDENTITY_FILE = path.join(STATE_DIR, 'host-device-identity.json');
const HOST_COMPANION_STATE_FILE = path.join(STATE_DIR, 'host-companion-device.json');
const CONNECTION_STATE_FILE = path.join(STATE_DIR, 'device-connections.json');
const ACCESS_STATE_FILE = path.join(STATE_DIR, 'device-access-grants.json');
const AGENT_CLIENT_STATE_FILE = path.join(STATE_DIR, 'agent-clients.json');
const ACCOUNT_STATE_FILE = path.join(STATE_DIR, 'accounts.json');
const USAGE_STATE_FILE = path.join(STATE_DIR, 'usage.json');
const LICENSE_STATE_FILE = path.join(STATE_DIR, 'license-keys.json');
const FLEET_AUTHORITY_TTL_MS = Number(process.env.OPERATOR_FLEET_AUTHORITY_TTL_MS || 10 * 60 * 1000);
const RING_HARD_CAP_BYTES = 10 * 1024 * 1024;
const MAX_RING_BYTES = Math.max(1024 * 1024, Math.min(Number(process.env.OPERATOR_RING_BYTES || 8 * 1024 * 1024), RING_HARD_CAP_BYTES));
const MAX_RING_AGE_MS = Math.max(60000, Math.min(Number(process.env.OPERATOR_RING_AGE_MS || 15 * 60 * 1000), 3600000));
const DISK_FLUSH_MS = Math.max(10, Math.min(Number(process.env.OPERATOR_DISK_FLUSH_MS || 50), 1000));
const DISK_BATCH_BYTES = Math.max(16384, Math.min(Number(process.env.OPERATOR_DISK_BATCH_BYTES || 262144), 1048576));
const MAX_RING_EVENTS = Number(process.env.OPERATOR_RING_EVENTS || 5000);
const MAX_MEMORY_OUTPUT = Number(process.env.OPERATOR_MEMORY_OUTPUT || 4 * 1024 * 1024);
const MAX_BODY_BYTES = Number(process.env.OPERATOR_MAX_BODY || 8 * 1024 * 1024);
const MAX_JOB_CACHE_BYTES = Number(process.env.OPERATOR_JOB_CACHE_BYTES || 64 * 1024 * 1024);
const MAX_JOB_CACHE_AGE_MS = Number(process.env.OPERATOR_JOB_CACHE_AGE_MS || 6 * 60 * 60 * 1000);
const OPERATION_DEDUPE_MS = Number(process.env.OPERATOR_DEDUPE_MS || 6 * 60 * 60 * 1000);
const SESSION_IDLE_MS = Number(process.env.OPERATOR_SESSION_IDLE_MS || 30 * 60 * 1000);
const SESSION_MIN_IDLE_MS = Number(process.env.OPERATOR_SESSION_MIN_IDLE_MS || 15 * 60 * 1000);
const SESSION_MAX_IDLE_MS = Number(process.env.OPERATOR_SESSION_MAX_IDLE_MS || 60 * 60 * 1000);
const SESSION_ACTIVE_WINDOW_MS = Number(process.env.OPERATOR_SESSION_ACTIVE_WINDOW_MS || 60 * 1000);
const SESSION_HISTORY_MS = Number(process.env.OPERATOR_SESSION_HISTORY_MS || 7 * 24 * 60 * 60 * 1000);
const MAX_ACTIVE_SESSIONS = Number(process.env.OPERATOR_MAX_ACTIVE_SESSIONS || 5);
const ACCOUNT_ID = String(process.env.OPERATOR_ACCOUNT_ID || 'self-hosted-local');
const ACCOUNT_PLAN = String(process.env.OPERATOR_ACCOUNT_PLAN || 'free').trim().toLowerCase();
const CONNECTION_LEASE_ENFORCE = ['1','true','yes'].includes(String(process.env.OPERATOR_CONNECTION_LEASE_ENFORCE || '0').toLowerCase());
const CONNECTION_REAP_MS = Number(process.env.OPERATOR_CONNECTION_REAP_MS || 30 * 1000);
const DEVICE_ID = String(process.env.OPERATOR_DEVICE_ID || 'arm-local');
const NODE_ID = String(process.env.OPERATOR_NODE_ID || 'arm');
const DEVICE_NAME = String(process.env.OPERATOR_DEVICE_NAME || os.hostname());
const DEVICE_POLICY_PROFILE = String(process.env.OPERATOR_DEVICE_POLICY_PROFILE || 'self-hosted-owner');
const DEVICE_PRESENCE_TTL_MS = Number(process.env.OPERATOR_DEVICE_PRESENCE_TTL_MS || 90 * 1000);
const DEVICE_HEARTBEAT_MS = Number(process.env.OPERATOR_DEVICE_HEARTBEAT_MS || 30 * 1000);
const ENROLLMENT_TTL_MS = Number(process.env.OPERATOR_ENROLLMENT_TTL_MS || 10 * 60 * 1000);
const ENROLLMENT_ACTIVATION_URL = String(process.env.OPERATOR_ENROLLMENT_ACTIVATION_URL || 'https://wall.dashboard.thaiduy.store/enroll');
const FLEET_CHANNEL_TTL_MS = Number(process.env.OPERATOR_FLEET_CHANNEL_TTL_MS || 20 * 1000);
const FLEET_COMMAND_LEASE_MS = Number(process.env.OPERATOR_FLEET_COMMAND_LEASE_MS || 12 * 1000);
const FLEET_MAX_QUEUED_PER_NODE = Number(process.env.OPERATOR_FLEET_MAX_QUEUED_PER_NODE || 64);
const DEVICE_CHANNEL_RUNTIME_LIMIT = Math.max(1, Number(process.env.OPERATOR_DEVICE_CHANNEL_RUNTIME_LIMIT || 240));
const DEVICE_CHANNEL_OBSERVER_LIMIT = Math.max(1, Number(process.env.OPERATOR_DEVICE_CHANNEL_OBSERVER_LIMIT || 240));
const DEVICE_CHANNEL_CONTROL_LIMIT = Math.max(1, Number(process.env.OPERATOR_DEVICE_CHANNEL_CONTROL_LIMIT || 120));
if (!Number.isFinite(DEVICE_PRESENCE_TTL_MS) || DEVICE_PRESENCE_TTL_MS < 10_000) throw new Error('invalid_device_presence_ttl');
if (!Number.isFinite(DEVICE_HEARTBEAT_MS) || DEVICE_HEARTBEAT_MS < 5_000 || DEVICE_HEARTBEAT_MS >= DEVICE_PRESENCE_TTL_MS) throw new Error('invalid_device_heartbeat');
const HOST_CAPABILITIES = ['filesystem', 'git', 'build-test', 'docker', 'lxd', 'systemctl', 'sudo-on-demand', 'terminal'];
const VERSION = runtimeVersion({envNames:['LIGHT_REMOTE_VERSION','OPERATOR_VERSION']});
const CLIENT_BACKWARD_RELEASES=Math.max(0,Math.min(Number(process.env.OPERATOR_CLIENT_BACKWARD_RELEASES)||3,20));
const MIN_SUPPORTED_CLIENT_VERSION=String(process.env.OPERATOR_MIN_SUPPORTED_CLIENT_VERSION||'').trim()||null;
const compatibilityFor=device=>clientCompatibility(VERSION,device?.agentVersion,{backwardReleases:CLIENT_BACKWARD_RELEASES,explicit:MIN_SUPPORTED_CLIENT_VERSION});
const HOST_PLATFORM_ADAPTER=createPlatformAdapter({platform:process.platform});
const NATIVE_PROCESSES=new NativeProcessRegistry();
const NATIVE_TERMINALS=new NativeTerminalRegistry({emit:event=>pushEvent(event)});
const NATIVE_SEARCHES=new NativeSearchRegistry();
const LIGHT_SCP=new LightScpRegistry();

const jobs = new Map();
const operationDedupe = new Map();
const replay = new Map();
const trustedChannelRateBuckets = new Map();
const ring = [];
const sseClients = new Set();
let ringBytes = 0;
let sequence = 0;
const usage = new UsageRegistry({ stateFile:USAGE_STATE_FILE });
const sessions = new SessionRegistry({ idleMs:SESSION_IDLE_MS, minIdleMs:SESSION_MIN_IDLE_MS, maxIdleMs:SESSION_MAX_IDLE_MS, activeWindowMs:SESSION_ACTIVE_WINDOW_MS, maxActive:MAX_ACTIVE_SESSIONS, historyMs:SESSION_HISTORY_MS, accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, emit:event => pushEvent(event) });
const devices = new DeviceRegistry({ stateFile:DEVICE_STATE_FILE, presenceTtlMs:DEVICE_PRESENCE_TTL_MS, emit:event => pushEvent(event) });
const enrollments = new EnrollmentRegistry({ stateFile:ENROLLMENT_STATE_FILE, signerFile:ENROLLMENT_SIGNER_FILE, activationBaseUrl:ENROLLMENT_ACTIVATION_URL, ttlMs:ENROLLMENT_TTL_MS, emit:event => pushEvent(event) });
const fleet = new FleetRouter({ channelTtlMs:FLEET_CHANNEL_TTL_MS, commandLeaseMs:FLEET_COMMAND_LEASE_MS, maxQueuedPerNode:FLEET_MAX_QUEUED_PER_NODE, emit:event => pushEvent(event) });
const connections = new DeviceConnectionRegistry({ stateFile:CONNECTION_STATE_FILE, emit:event => pushEvent(event) });
const accessGrants = new DeviceAccessGrantRegistry({ stateFile:ACCESS_STATE_FILE, emit:event => pushEvent(event) });
const pairingCodes = new DevicePairingRegistry({ emit:event => pushEvent(event) });
const agentClients = new AgentClientRegistry({ stateFile:AGENT_CLIENT_STATE_FILE, emit:event => pushEvent(event) });
const accounts = new AccountRegistry({ stateFile:ACCOUNT_STATE_FILE, bootstrapAccountId:ACCOUNT_ID, emit:event => pushEvent(event) });
const licenses = new LicenseKeyRegistry({ stateFile:LICENSE_STATE_FILE, emit:event => pushEvent(event) });
const fleetAuthority = new FleetAuthorityRegistry({ ttlMs:FLEET_AUTHORITY_TTL_MS, emit:event => pushEvent(event) });
const hostIdentity = loadOrCreateHostDeviceIdentity(HOST_DEVICE_IDENTITY_FILE);

fs.mkdirSync(LOG_DIR, { recursive: true });
function redact(value) {
  if (value == null) return value;
  let text = String(value);
  text = text.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig, '$1[REDACTED]');
  text = text.replace(/(bearer\s+)[A-Za-z0-9._~+\/-]{20,}/ig, '$1[REDACTED]');
  text = text.replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  text = text.replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*)[^\s"']+/ig, '$1[REDACTED]');
  return text;
}

let diskQueue = []; let diskQueueBytes = 0; let diskFlushTimer = null; let diskWriteChain = Promise.resolve();function serializedDiskRecord(event) {
  const safe = { ...event };
  for (const key of ['script', 'stdout', 'stderr', 'chunk', 'note']) if (safe[key] != null) safe[key] = redact(safe[key]);
  return JSON.stringify(safe)+"\n";
}

function flushDiskRecords(){if(diskFlushTimer){clearTimeout(diskFlushTimer);diskFlushTimer=null;}if(!diskQueue.length)return diskWriteChain;const batch=diskQueue.join('');diskQueue=[];diskQueueBytes=0;diskWriteChain=diskWriteChain.then(()=>fs.promises.appendFile(LOG_FILE,batch,{encoding:'utf8'})).catch(e=>console.error('[disk] append failed',e?.message||e));return diskWriteChain;}
function queueDiskRecord(event){const line=serializedDiskRecord(event);diskQueue.push(line);diskQueueBytes+=Buffer.byteLength(line);if(diskQueueBytes>=DISK_BATCH_BYTES)void flushDiskRecords();else if(!diskFlushTimer){diskFlushTimer=setTimeout(()=>void flushDiskRecords(),DISK_FLUSH_MS);diskFlushTimer.unref?.();}}function pruneRing(now=Date.now()){const cutoff=now-MAX_RING_AGE_MS;while(ring.length&&(ring.length>MAX_RING_EVENTS||ringBytes>MAX_RING_BYTES||ring[0].atMs<cutoff)){const old=ring.shift();ringBytes-=old.bytes;}}function pushEvent(input) {
  const now=Date.now(); const event={id:++sequence,at:new Date(now).toISOString(),...input};
  const encoded = JSON.stringify(event);
  const bytes = Buffer.byteLength(encoded);
  ring.push({ event, bytes, atMs:now });
  ringBytes += bytes;
  pruneRing(now);
  const frame = `id: ${event.id}\nevent: activity\ndata: ${encoded}\n\n`;
  for (const res of sseClients) { try { res.write(frame); } catch {} }
  try { usage.ingest(event); } catch (error) { console.error('[usage] ingest failed', error?.message || error); }
  queueDiskRecord(event);
  return event;
}
if (devices.loadError) pushEvent({ type:'device_registry_load_error', status:'error', detail:redact(devices.loadError) });
if (enrollments.loadError) pushEvent({ type:'enrollment_registry_load_error', status:'error', detail:redact(enrollments.loadError) });
if (connections.loadError) pushEvent({ type:'device_connection_registry_load_error', status:'error', detail:redact(connections.loadError) });
if (accessGrants.loadError) pushEvent({ type:'device_access_registry_load_error', status:'error', detail:redact(accessGrants.loadError) });
if (agentClients.loadError) pushEvent({ type:'agent_client_registry_load_error', status:'error', detail:redact(agentClients.loadError) });
if (accounts.loadError) pushEvent({ type:'account_registry_load_error', status:'error', detail:redact(accounts.loadError) });
if (licenses.loadError) pushEvent({ type:'license_registry_load_error', status:'error', detail:redact(licenses.loadError) });
if (usage.loadError) pushEvent({ type:'usage_registry_load_error', status:'error', detail:redact(usage.loadError) });
const hostBinding=enrollments.ensureTrustedBinding({accountId:ACCOUNT_ID,deviceId:DEVICE_ID,publicIdentityKey:hostIdentity.publicKey,displayName:DEVICE_NAME,platform:os.platform(),architecture:os.arch(),agentVersion:VERSION,fingerprintSummary:`integrated hub / ${os.platform()} ${os.arch()} / key ${hostIdentity.publicKeySha256.slice(0,12)}`,capabilities:HOST_CAPABILITIES,policyProfile:DEVICE_POLICY_PROFILE});
ensureHostCompanionState(HOST_COMPANION_STATE_FILE,{identity:hostIdentity,binding:hostBinding,signer:enrollments.signerInfo(),nodeId:NODE_ID});
devices.register({ accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, displayName:DEVICE_NAME, platform:os.platform(), architecture:os.arch(), agentVersion:VERSION, publicIdentityKey:hostBinding.publicIdentityKey, capabilities:hostEffectiveCapabilities(), policyProfile:DEVICE_POLICY_PROFILE });
const deviceHeartbeat = setInterval(() => { try { devices.heartbeat(DEVICE_ID,{capabilities:hostEffectiveCapabilities()}); } catch (error) { console.error('[device] heartbeat failed', error?.message || error); } }, DEVICE_HEARTBEAT_MS);
deviceHeartbeat.unref();
function reapAccessGrants(){
  return accessGrants.reap({connectionForDevice:deviceId=>connections.get(deviceId),liveSessionsForDevice:deviceId=>sessions.activeCountByDevice(deviceId)});
}
const connectionReaper = setInterval(() => {
  try {
    const closed=connections.reap();
    for(const item of closed){ sessions.closeByDevice(item.deviceId,`device_${item.reason}`,{force:true}); accessGrants.closeByDevice(item.deviceId,`device_${item.reason}`); pairingCodes.invalidateDevice(item.deviceId,`device_${item.reason}`); agentClients.removeDevice(item.deviceId,`device_${item.reason}`); }
    pairingCodes.reap();agentClients.reap();reapAccessGrants();
  } catch(error) { console.error('[connection] reap failed', error?.message || error); }
}, Math.max(5000,CONNECTION_REAP_MS));
connectionReaper.unref();

function pruneReplay(now = Date.now()) {
  for (const [id, exp] of replay) if (exp <= now) replay.delete(id);
}

function decryptEnvelope(envelope) {
  const now = Date.now();
  pruneReplay(now);
  const requestId = envelope?.requestId;
  const iat = Number(envelope?.iat);
  const exp = Number(envelope?.exp);
  if (!requestId || !Number.isFinite(iat) || !Number.isFinite(exp)) throw new Error('invalid_envelope');
  if (iat > now + 30000 || exp < now || exp - iat > 120000) throw new Error('expired_envelope');
  if (replay.has(requestId)) throw new Error('replay_detected');
  let result;
  try { result = decryptSealedEnvelope(envelope, KEY_FILE); }
  catch (error) {
    if (error?.message === 'unknown_kid') throw error;
    throw new Error('invalid_envelope_auth');
  }
  replay.set(requestId, exp);
  return result;
}

function createAccumulator(limit = MAX_MEMORY_OUTPUT) {
  let total = 0;
  let full = '';
  let head = '';
  let tail = '';
  let truncated = false;
  return {
    add(chunk) {
      const text = String(chunk);
      total += Buffer.byteLength(text);
      if (!truncated && Buffer.byteLength(full) + Buffer.byteLength(text) <= limit) {
        full += text;
        return;
      }
      if (!truncated) {
        truncated = true;
        const headTarget = Math.floor(limit * 0.25);
        const tailTarget = limit - headTarget;
        head = Buffer.from(full).subarray(0, headTarget).toString('utf8');
        tail = Buffer.from(full).subarray(-tailTarget).toString('utf8');
        full = '';
      }
      const tailTarget = Math.floor(limit * 0.75);
      tail = Buffer.from(tail + text).subarray(-tailTarget).toString('utf8');
    },
    snapshot() {
      return truncated
        ? { text: `${head}\n\n[... output truncated in memory; full copy is on disk ...]\n\n${tail}`, totalBytes: total, truncated: true }
        : { text: full, totalBytes: total, truncated: false };
    }
  };
}

function telemetryTimestamp(value,now=Date.now()) {
  const n=Number(value);
  return Number.isSafeInteger(n)&&n>0&&Math.abs(now-n)<=24*60*60*1000?n:null;
}
function ingressTelemetry(raw={},operatorAcceptedAt=Date.now()) {
  return {bridgeReceivedAt:telemetryTimestamp(raw?.bridgeReceivedAt,operatorAcceptedAt),gatewayAcceptedAt:telemetryTimestamp(raw?.gatewayAcceptedAt,operatorAcceptedAt),operatorAcceptedAt};
}
function applyDeviceTelemetry(job,raw={}) {
  const now=Date.now(),next={...(job.telemetry||{})};
  for(const key of ['deviceReceivedAt','firstOutputAt','completedAt']){const value=telemetryTimestamp(raw?.[key],now);if(value)next[key]=value;}
  job.telemetry=next;if(next.firstOutputAt)job.firstOutputAt=next.firstOutputAt;return next;
}
function latencyView(job) {
  const t=job.telemetry||{},dispatchAt=t.dispatchAt??job.startedAt??null,deviceReceivedAt=t.deviceReceivedAt??(!job.remote?job.startedAt:null),firstOutputAt=t.firstOutputAt??job.firstOutputAt??null,completedAt=t.completedAt??job.finishedAt??null;
  const delta=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a?b-a:null;
  return {bridgeReceivedAt:t.bridgeReceivedAt??null,gatewayAcceptedAt:t.gatewayAcceptedAt??null,operatorAcceptedAt:t.operatorAcceptedAt??null,dispatchAt,deviceReceivedAt,firstOutputAt,completedAt,bridgeMs:delta(t.bridgeReceivedAt,t.gatewayAcceptedAt),gatewayMs:delta(t.gatewayAcceptedAt,t.operatorAcceptedAt),dispatchMs:delta(t.operatorAcceptedAt,deviceReceivedAt),firstByteMs:delta(deviceReceivedAt,firstOutputAt),executionMs:delta(deviceReceivedAt,completedAt)};
}

function jobView(job) {
  const out = job.stdout.snapshot();
  const err = job.stderr.snapshot();
  return {
    jobId: job.id, requestId: job.requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId: job.agentId, nodeId: job.nodeId, status: job.status,
    cwd: job.cwd, script: redact(job.script), note: redact(job.note || ''), pid: job.pid || null, route:job.remote?'outbound-leaf':'local', commandId:job.commandId||null, requiredCapabilities:[...(job.requiredCapabilities||[])],
    startedAt: job.startedAt, finishedAt: job.finishedAt || null, exitCode: job.exitCode,
    signal: job.signal || null, durationMs: job.finishedAt ? job.finishedAt - job.startedAt : Date.now() - job.startedAt,
    stdout: redact(out.text), stderr: redact(err.text), stdoutBytes: out.totalBytes, stderrBytes: err.totalBytes,
    outputTruncated: out.truncated || err.truncated, resultData:job.resultData ?? null, resultSummary:redact(job.resultSummary||''), toolMeta:job.toolMeta||null, latency:latencyView(job)
  };
}
function approximateJobMemoryBytes(job) {
  const out = job.stdout.snapshot();
  const err = job.stderr.snapshot();
  return Buffer.byteLength(out.text) + Buffer.byteLength(err.text) + Buffer.byteLength(job.script || '');
}

function pruneJobs(now = Date.now()) {
  for (const [op, entry] of operationDedupe) if (entry.expiresAt <= now) operationDedupe.delete(op);
  for (const [id, job] of jobs) {
    if (job.finishedAt && now - job.finishedAt > MAX_JOB_CACHE_AGE_MS) jobs.delete(id);
  }
  const finished = [...jobs.values()].filter(job => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
  let bytes = finished.reduce((sum, job) => sum + approximateJobMemoryBytes(job), 0);
  while (bytes > MAX_JOB_CACHE_BYTES && finished.length > 1) {
    const old = finished.shift();
    bytes -= approximateJobMemoryBytes(old);
    jobs.delete(old.id);
  }
}

function finishJob(job, exitCode, signal) {
  if (job.finishedAt) return;
  job.finishedAt = Date.now();
  job.telemetry={...(job.telemetry||{}),completedAt:job.telemetry?.completedAt||job.finishedAt};
  if(!job.telemetry.deviceReceivedAt&&!job.remote)job.telemetry.deviceReceivedAt=job.startedAt;
  if(!job.firstOutputAt)job.firstOutputAt=job.telemetry.firstOutputAt||job.finishedAt;
  if(!job.telemetry.firstOutputAt)job.telemetry.firstOutputAt=job.firstOutputAt;
  job.exitCode = exitCode;
  job.signal = signal || null;
  job.status = exitCode === 0 ? 'ok' : job.timedOut ? 'timeout' : 'error';
  clearTimeout(job.timer);
  sessions.finishJob(job.sessionId, job.id, job.status);
  if (job.autoCloseSession) { try { sessions.close(job.sessionId, job.agentId); } catch {} }
  pushEvent({ type: 'job_finished', jobId: job.id, requestId: job.requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId:job.agentId, nodeId:job.nodeId,
    status: job.status, exitCode, signal: signal || null, durationMs: job.finishedAt - job.startedAt, resultSummary:redact(job.resultSummary||''), toolMeta:job.toolMeta||null, latency:latencyView(job) });
  for (const resolve of job.waiters.splice(0)) resolve();
  pruneJobs(job.finishedAt);
}

function emitStream(job, stream, data) {
  const now=Date.now();if(!job.firstOutputAt){job.firstOutputAt=now;job.telemetry={...(job.telemetry||{}),firstOutputAt:job.telemetry?.firstOutputAt||now};}
  const text = data.toString('utf8');
  job[stream].add(text);
  for (let i = 0; i < text.length; i += 16384) {
    pushEvent({ type: stream, jobId: job.id, requestId: job.requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId:job.agentId, nodeId:job.nodeId,
      status: 'running', chunk: redact(text.slice(i, i + 16384)) });
  }
}

function startJob(payload, requestId) {
  pruneJobs();
  const operationId = String(payload.operationId || '').trim();
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId)) throw new Error('invalid_operation_id');
  const script = String(payload.script || '');
  if (!script.trim()) throw new Error('empty_script');
  if (Buffer.byteLength(script) > 1024 * 1024) throw new Error('script_too_large');
  const timeoutMs = Math.max(1000, Math.min(Number(payload.timeoutMs) || 600000, 7200000));
  const shell = String(payload.shell || 'default');
  const requestedSessionId = String(payload.sessionId || '');
  const agentId = String(payload.agentId || '').trim();
  const session = sessions.ensure(requestedSessionId, { agentId });
  requireDeviceConnection(session.deviceId);
  if (payload.nodeId != null && String(payload.nodeId) !== session.nodeId) throw new SessionError('session_target_mismatch',409);
  const remote=session.nodeId!==NODE_ID;
  let cwd=payload.cwd==null||String(payload.cwd)==='' ? (remote?'':'/home/ubuntu') : String(payload.cwd);
  if (cwd.length>1024 || cwd.includes('\0') || (!remote && !cwd)) throw new Error('invalid_cwd');
  if (!remote) {
    cwd=path.resolve(cwd);
    const stat = fs.statSync(cwd);
    if (!stat.isDirectory()) throw new Error('cwd_not_directory');
  }
  const requiredCapabilities=[];
  for(const raw of Array.isArray(payload.requiredCapabilities)&&payload.requiredCapabilities.length?payload.requiredCapabilities:['filesystem']) {
    const item=String(raw||'').trim();
    if(!/^[A-Za-z0-9._:-]{1,80}$/.test(item))throw new Error('invalid_required_capability');
    if(!requiredCapabilities.includes(item))requiredCapabilities.push(item);
  }
  if(!remote){
    for(const raw of HOST_PLATFORM_ADAPTER.inferRequiredCapabilities(script,{shell}))if(!requiredCapabilities.includes(raw))requiredCapabilities.push(raw);
    const denied=HOST_PLATFORM_ADAPTER.hardDeny?.(script)||null;if(denied)throw new DeviceError(`local platform policy denied: ${denied}`,403);
  }
  requiredCapabilities.sort();
  let route=null;
  if(remote) {
    route=targetRoute(session.nodeId,session.accountId);
    if(route.deviceId!==session.deviceId)throw new SessionError('session_target_mismatch',409);
    const missing=requiredCapabilities.filter(cap=>!route.capabilities.includes(cap));
    if(missing.length)throw new FleetError('target_node_capability_missing',409);
  } else {
    const missing=requiredCapabilities.filter(cap=>!hostEffectiveCapabilities().includes(cap));
    if(missing.length)throw new DeviceError('local_host_capability_missing',409);
  }
  sessions.record(session.id, 'toolCalls');
  sessions.record(session.id, 'execCalls');
  const sessionId = session.id;
  const note = String(payload.note || '');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ script, cwd, shell, timeoutMs, sessionId, note, nodeId:session.nodeId, requiredCapabilities })).digest('hex');
  const existing = operationDedupe.get(operationId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error('operation_id_conflict');
    const prior = jobs.get(existing.jobId); if (prior) return prior; operationDedupe.delete(operationId);
  }
  const job = {
    id: crypto.randomUUID(), requestId, operationId, operationFingerprint: fingerprint, accountId:session.accountId, deviceId:session.deviceId, sessionId, agentId:session.agentId, nodeId:session.nodeId, note,
    cwd, script, shell, status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, signal: null,
    timedOut: false, stdout: createAccumulator(), stderr: createAccumulator(), waiters: [], pid: null, timer: null,
    remote, commandId:null, requiredCapabilities
  };
  jobs.set(job.id, job);
  sessions.attachJob(job.sessionId, job.id);
  operationDedupe.set(operationId, { jobId: job.id, fingerprint, expiresAt: Date.now() + OPERATION_DEDUPE_MS });
  pushEvent({ type: 'job_started', jobId: job.id, requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId:job.agentId, nodeId:job.nodeId, status: 'running', route:remote?'outbound-leaf':'local', requiredCapabilities,
    cwd, script: redact(script), note: redact(job.note), timeoutMs });
  if(remote) {
    const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'exec',operationId,sessionId,agentId:job.agentId,script,cwd,shell,timeoutMs,note,requiredCapabilities}});
    job.commandId=command.commandId;
    job.timer=setTimeout(()=>{
      if(job.finishedAt)return;
      fleet.abandon(job.commandId,'remote_result_timeout');
      job.timedOut=true;
      emitStream(job,'stderr',Buffer.from('remote command result timeout\n'));
      finishJob(job,124,null);
    },timeoutMs+FLEET_CHANNEL_TTL_MS*2);
    job.timer.unref();
    return job;
  }
  const localSpec=HOST_PLATFORM_ADAPTER.commandFor(script,{shell});
  const child = spawn(localSpec.file, localSpec.args, { cwd, env: { ...process.env, GPT_OPERATOR_ACCOUNT:job.accountId, GPT_OPERATOR_DEVICE:job.deviceId, GPT_OPERATOR_NODE:job.nodeId, GPT_OPERATOR_SESSION: job.sessionId }, stdio: ['ignore', 'pipe', 'pipe'] });
  job.pid = child.pid || null;
  child.stdout.on('data', data => emitStream(job, 'stdout', data));
  child.stderr.on('data', data => emitStream(job, 'stderr', data));
  child.on('error', error => { emitStream(job, 'stderr', Buffer.from(`${error.message}\n`)); finishJob(job, 127, null); });
  child.on('exit', (code, signal) => finishJob(job, code ?? 128, signal));
  job.timer = setTimeout(() => {
    if (job.finishedAt) return;
    job.timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => { if (!job.finishedAt) child.kill('SIGKILL'); }, 5000).unref();
  }, timeoutMs);
  job.timer.unref();
  return job;
}
async function startFsOperation(payload,requestId){
  const operationId=String(payload.operationId||'').trim();
  if(!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId))throw new Error('invalid_operation_id');
  const agentId=String(payload.agentId||'').trim(),session=sessions.ensure(String(payload.sessionId||''),{agentId});
  requireDeviceConnection(session.deviceId);
  if(payload.nodeId!=null&&String(payload.nodeId)!==session.nodeId)throw new SessionError('session_target_mismatch',409);
  const fsRequest=payload.fs&&typeof payload.fs==='object'&&!Array.isArray(payload.fs)?payload.fs:null;
  if(!fsRequest)throw new Error('filesystem_request_required');
  const remote=session.nodeId!==NODE_ID,requiredCapabilities=['filesystem'];
  if(remote){const route=targetRoute(session.nodeId,session.accountId);if(route.deviceId!==session.deviceId)throw new SessionError('session_target_mismatch',409);if(!route.capabilities.includes('filesystem'))throw new FleetError('target_node_capability_missing',409);}
  else if(!hostEffectiveCapabilities().includes('filesystem'))throw new DeviceError('local_host_capability_missing',409);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({fsRequest,sessionId:session.id,nodeId:session.nodeId})).digest('hex');
  const existing=operationDedupe.get(operationId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('operation_id_conflict');const prior=jobs.get(existing.jobId);if(prior)return prior;operationDedupe.delete(operationId);}
  const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,accountId:session.accountId,deviceId:session.deviceId,sessionId:session.id,agentId:session.agentId,nodeId:session.nodeId,note:`native-fs:${String(fsRequest.op||'unknown')}`,cwd:'',script:'',status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:createAccumulator(),stderr:createAccumulator(),waiters:[],pid:null,timer:null,remote,commandId:null,requiredCapabilities,resultData:null};
  jobs.set(job.id,job);sessions.attachJob(job.sessionId,job.id);sessions.record(job.sessionId,'toolCalls');operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+OPERATION_DEDUPE_MS});
  pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId,nodeId:job.nodeId,status:'running',route:remote?'outbound-leaf':'local',requiredCapabilities,note:job.note});
  if(remote){const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'fs',operationId,sessionId:job.sessionId,agentId:job.agentId,fs:fsRequest}});job.commandId=command.commandId;job.timer=setTimeout(()=>{if(job.finishedAt)return;fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;finishJob(job,124,null);},60000+FLEET_CHANNEL_TTL_MS*2);job.timer.unref();return job;}
  Promise.resolve().then(()=>executeNativeFs(fsRequest,{policy:filesystemPolicy()})).then(data=>{job.resultData=data;finishJob(job,0,null);}).catch(error=>{job.resultData={ok:false,error:String(error?.message||error),status:Number(error?.status)||500};emitStream(job,'stderr',Buffer.from(String(error?.message||error)+'\n'));finishJob(job,1,null);});
  return job;
}

async function startScpOperation(payload,requestId){
  const operationId=String(payload.operationId||'').trim();if(!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId))throw new Error('invalid_operation_id');
  const agentId=String(payload.agentId||'').trim(),session=sessions.ensure(String(payload.sessionId||''),{agentId});requireDeviceConnection(session.deviceId);
  if(payload.nodeId!=null&&String(payload.nodeId)!==session.nodeId)throw new SessionError('session_target_mismatch',409);
  const request=payload.scp&&typeof payload.scp==='object'&&!Array.isArray(payload.scp)?payload.scp:null;if(!request)throw new Error('scp_request_required');
  const remote=session.nodeId!==NODE_ID,requiredCapabilities=['filesystem'];
  if(remote){const route=targetRoute(session.nodeId,session.accountId);if(route.deviceId!==session.deviceId)throw new SessionError('session_target_mismatch',409);if(!route.capabilities.includes('filesystem'))throw new FleetError('target_node_capability_missing',409);}else if(!hostEffectiveCapabilities().includes('filesystem'))throw new DeviceError('local_host_capability_missing',409);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({request,sessionId:session.id,nodeId:session.nodeId})).digest('hex'),existing=operationDedupe.get(operationId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('operation_id_conflict');const prior=jobs.get(existing.jobId);if(prior)return prior;operationDedupe.delete(operationId);}
  const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,accountId:session.accountId,deviceId:session.deviceId,sessionId:session.id,agentId:session.agentId,nodeId:session.nodeId,note:`light-scp:${String(request.op||'unknown')}`,cwd:String(request.destination||request.source||''),script:'',status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:createAccumulator(),stderr:createAccumulator(),waiters:[],pid:null,timer:null,remote,commandId:null,requiredCapabilities,resultData:null};
  jobs.set(job.id,job);sessions.attachJob(job.sessionId,job.id);sessions.record(job.sessionId,'toolCalls');operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+OPERATION_DEDUPE_MS});
  pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId,nodeId:job.nodeId,status:'running',route:remote?'outbound-leaf':'local',requiredCapabilities,note:job.note});
  if(remote){const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'scp',operationId,sessionId:job.sessionId,agentId:job.agentId,scp:request}});job.commandId=command.commandId;job.timer=setTimeout(()=>{if(job.finishedAt)return;fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;finishJob(job,124,null);},60000+FLEET_CHANNEL_TTL_MS*2);job.timer.unref();return job;}
  Promise.resolve().then(()=>executeLocalScpRequest(job,request)).then(data=>{job.resultData=data;finishJob(job,0,null);}).catch(error=>{job.resultData={ok:false,error:String(error?.message||error),status:Number(error?.status)||500};emitStream(job,'stderr',Buffer.from(String(error?.message||error)+'\n'));finishJob(job,1,null);});return job;
}

async function executeLocalScpRequest(job,request){
  const owner={accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId},op=String(request.op||'');
  if(op==='upload-begin')return {ok:true,operation:op,transfer:await LIGHT_SCP.beginUpload(owner,request)};
  if(op==='upload-chunk')return {ok:true,operation:op,transfer:await LIGHT_SCP.putUploadChunk(owner,request.transferId,request)};
  if(op==='upload-commit')return {ok:true,operation:op,result:await LIGHT_SCP.commitUpload(owner,request.transferId)};
  if(op==='download-begin')return {ok:true,operation:op,transfer:await LIGHT_SCP.beginDownload(owner,request)};
  if(op==='download-chunk')return {ok:true,operation:op,chunk:await LIGHT_SCP.readDownloadChunk(owner,request.transferId,request)};
  if(op==='status')return {ok:true,operation:op,transfer:await LIGHT_SCP.status(owner,request.transferId)};
  if(op==='cancel')return {ok:true,operation:op,result:await LIGHT_SCP.cancel(owner,request.transferId)};
  throw new Error('scp_operation_unsupported');
}

async function startProcessOperation(payload,requestId){
  const operationId=String(payload.operationId||'').trim();if(!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId))throw new Error('invalid_operation_id');
  const agentId=String(payload.agentId||'').trim(),session=sessions.ensure(String(payload.sessionId||''),{agentId});requireDeviceConnection(session.deviceId);
  if(payload.nodeId!=null&&String(payload.nodeId)!==session.nodeId)throw new SessionError('session_target_mismatch',409);
  const request=payload.process&&typeof payload.process==='object'&&!Array.isArray(payload.process)?payload.process:null;if(!request)throw new Error('process_request_required');
  const remote=session.nodeId!==NODE_ID,requiredCapabilities=['filesystem'];
  if(remote){const route=targetRoute(session.nodeId,session.accountId);if(route.deviceId!==session.deviceId)throw new SessionError('session_target_mismatch',409);if(!route.capabilities.includes('filesystem'))throw new FleetError('target_node_capability_missing',409);}else if(!hostEffectiveCapabilities().includes('filesystem'))throw new DeviceError('local_host_capability_missing',409);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({request,sessionId:session.id,nodeId:session.nodeId})).digest('hex'),existing=operationDedupe.get(operationId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('operation_id_conflict');const prior=jobs.get(existing.jobId);if(prior)return prior;operationDedupe.delete(operationId);}
  const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,accountId:session.accountId,deviceId:session.deviceId,sessionId:session.id,agentId:session.agentId,nodeId:session.nodeId,note:`native-process:${String(request.op||'unknown')}`,cwd:String(request.cwd||''),script:String(request.script||''),status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:createAccumulator(),stderr:createAccumulator(),waiters:[],pid:null,timer:null,remote,commandId:null,requiredCapabilities,resultData:null};
  jobs.set(job.id,job);sessions.attachJob(job.sessionId,job.id);sessions.record(job.sessionId,'toolCalls');operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+OPERATION_DEDUPE_MS});
  pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId,nodeId:job.nodeId,status:'running',route:remote?'outbound-leaf':'local',requiredCapabilities,note:job.note});
  if(remote){const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'process',operationId,sessionId:job.sessionId,agentId:job.agentId,process:request}});job.commandId=command.commandId;job.timer=setTimeout(()=>{if(job.finishedAt)return;fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;finishJob(job,124,null);},30000+FLEET_CHANNEL_TTL_MS*2);job.timer.unref();return job;}
  Promise.resolve().then(()=>executeLocalProcessRequest(job,request)).then(data=>{job.resultData=data;finishJob(job,0,null);}).catch(error=>{job.resultData={ok:false,error:String(error?.message||error),status:Number(error?.status)||500};emitStream(job,'stderr',Buffer.from(String(error?.message||error)+'\n'));finishJob(job,1,null);});return job;
}

async function executeLocalProcessRequest(job,request){
  const owner={accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId},op=String(request.op||'');
  if(op==='start'){
    const script=String(request.script||'');if(!script.trim())throw new Error('process_script_required');
    const required=[...new Set([...(Array.isArray(request.requiredCapabilities)?request.requiredCapabilities:[]),...HOST_PLATFORM_ADAPTER.inferRequiredCapabilities(script,{shell:request.shell})])].sort();
    const denied=HOST_PLATFORM_ADAPTER.hardDeny?.(script)||null;if(denied)throw new Error(`local platform policy denied: ${denied}`);
    const missing=required.filter(cap=>!hostEffectiveCapabilities().includes(cap));if(missing.length)throw new DeviceError('local_host_capability_missing',409);
    const cwd=path.resolve(String(request.cwd||'/home/ubuntu'));let stat;try{stat=fs.statSync(cwd);}catch{}if(!stat?.isDirectory())throw new Error('cwd_not_directory');
    return {ok:true,operation:'start',process:NATIVE_PROCESSES.start({...owner,script,cwd,timeoutMs:request.timeoutMs,spawnSpec:value=>HOST_PLATFORM_ADAPTER.commandFor(value,{shell:request.shell}),env:{GPT_OPERATOR_ACCOUNT:job.accountId,GPT_OPERATOR_DEVICE:job.deviceId,GPT_OPERATOR_NODE:job.nodeId,GPT_OPERATOR_SESSION:job.sessionId}})};
  }
  if(!hostEffectiveCapabilities().includes('filesystem'))throw new DeviceError('local_host_capability_missing',409);
  if(op==='input')return {ok:true,operation:'input',process:NATIVE_PROCESSES.input(request.processId,owner,{data:request.data,eof:Boolean(request.eof)})};
  if(op==='output')return {ok:true,operation:'output',...NATIVE_PROCESSES.output(request.processId,owner,{stream:request.stream,offset:request.offset,limit:request.limit})};
  if(op==='stop')return {ok:true,operation:'stop',process:NATIVE_PROCESSES.stop(request.processId,owner,{force:Boolean(request.force)})};
  if(op==='list')return {ok:true,operation:'list',processes:NATIVE_PROCESSES.list(owner)};
  throw new Error('process_operation_unsupported');
}

function shortTerminalId(value){const text=String(value||'');return text.length>18?text.slice(0,18)+'…':text;}
function terminalInputPreview(value){
  const raw=String(value||''),bytes=Buffer.byteLength(raw),unsafeControl=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw);
  let text=raw.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g,'').replace(/\n+/g,' ↵ ').trim();
  const safeBare=/^(?:pwd|ls|id|whoami|date|uptime|clear|exit|env|set|help|history|jobs|fg|bg|ps|top|htop|df|du|free|uname|hostname|stty)$/i.test(text),bare=/^[^\s|;&<>]+$/.test(text);
  const suspicious=(bare&&!safeBare)||/^(?:[A-Za-z0-9._~+\/=-]{16,})$/.test(text)||/(?:password|passwd|token|secret|api[_-]?key|authorization|bearer|private key)/i.test(text);
  if(unsafeControl||suspicious)text='';else text=redact(text).slice(0,180);
  return {bytes,preview:text};
}
function terminalWallMeta(request={}){
  const op=String(request.op||'unknown').toLowerCase(),terminalId=String(request.terminalId||''),handle=shortTerminalId(terminalId),input=op==='input'?terminalInputPreview(request.data):{bytes:0,preview:''};
  let label='PTY '+op.toUpperCase();
  if(op==='start')label+=' · '+String(request.shell||'default')+' · '+String(Number(request.cols)||120)+'×'+String(Number(request.rows)||32)+(request.cwd?' · '+String(request.cwd):'');
  else if(op==='input')label+=' · '+(handle||'terminal')+' · '+(input.preview||String(input.bytes)+' B input');
  else if(op==='output')label+=' · '+(handle||'terminal')+' · offset '+String(Math.max(0,Number(request.offset)||0))+' · limit '+String(Math.max(1,Number(request.limit)||262144))+' B';
  else if(op==='resize')label+=' · '+(handle||'terminal')+' · '+String(Number(request.cols)||120)+'×'+String(Number(request.rows)||32);
  else if(op==='signal')label+=' · '+(handle||'terminal')+' · '+String(request.signal||'interrupt');
  else if(op==='stop')label+=' · '+(handle||'terminal')+' · '+(request.force?'force':'graceful');
  return {kind:'terminal',op,terminalId:terminalId||null,shell:op==='start'?String(request.shell||'default'):null,cwd:op==='start'?String(request.cwd||''):null,cols:['start','resize'].includes(op)?Number(request.cols)||null:null,rows:['start','resize'].includes(op)?Number(request.rows)||null:null,signal:op==='signal'?String(request.signal||'interrupt'):null,force:op==='stop'?Boolean(request.force):null,inputBytes:op==='input'?input.bytes:null,inputPreview:op==='input'?(input.preview||null):null,label:redact(label)};
}
function terminalResultSummary(data){
  if(!data||typeof data!=='object')return '';
  const op=String(data.operation||''),list=Array.isArray(data.terminals)?data.terminals:null;
  if(op==='list'&&list){const running=list.filter(x=>x&&x.state==='running').length;return list.length+' terminal'+(list.length===1?'':'s')+' · '+running+' running';}
  const t=data.terminal&&typeof data.terminal==='object'?data.terminal:data,parts=[];
  if(t.state)parts.push(String(t.state));if(t.terminalId)parts.push(shortTerminalId(t.terminalId));if(op==='start'&&t.pid)parts.push('pid '+String(t.pid));
  if(op==='resize'&&t.cols&&t.rows)parts.push(String(t.cols)+'×'+String(t.rows));
  if(op==='output'&&data.output){parts.push(String(Number(data.output.returnedBytes)||0)+' B');parts.push('offset '+String(Number(data.output.nextOffset)||0)+'/'+String(Number(data.output.totalBytes)||0));}
  else if((op==='input'||op==='signal'||op==='stop')&&Number.isFinite(Number(t.outputBytes)))parts.push('buffer '+String(Number(t.outputBytes)||0)+' B');
  return parts.join(' · ');
}

async function startTerminalOperation(payload,requestId){
  const operationId=String(payload.operationId||'').trim();if(!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId))throw new Error('invalid_operation_id');
  const agentId=String(payload.agentId||'').trim(),session=sessions.ensure(String(payload.sessionId||''),{agentId});requireDeviceConnection(session.deviceId);
  if(payload.nodeId!=null&&String(payload.nodeId)!==session.nodeId)throw new SessionError('session_target_mismatch',409);
  const request=payload.terminal&&typeof payload.terminal==='object'&&!Array.isArray(payload.terminal)?payload.terminal:null;if(!request)throw new Error('terminal_request_required');
  const remote=session.nodeId!==NODE_ID,requiredCapabilities=['terminal'];
  if(remote){const route=targetRoute(session.nodeId,session.accountId);if(route.deviceId!==session.deviceId)throw new SessionError('session_target_mismatch',409);if(!route.capabilities.includes('terminal'))throw new FleetError('target_node_capability_missing',409);}else if(!hostEffectiveCapabilities().includes('terminal'))throw new DeviceError('local_host_capability_missing',409);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({request,sessionId:session.id,nodeId:session.nodeId})).digest('hex'),existing=operationDedupe.get(operationId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('operation_id_conflict');const prior=jobs.get(existing.jobId);if(prior)return prior;operationDedupe.delete(operationId);}
  const toolMeta=terminalWallMeta(request);
  const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,accountId:session.accountId,deviceId:session.deviceId,sessionId:session.id,agentId:session.agentId,nodeId:session.nodeId,note:`native-terminal:${toolMeta.op}`,cwd:String(toolMeta.cwd||''),script:toolMeta.label,status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:createAccumulator(),stderr:createAccumulator(),waiters:[],pid:null,timer:null,remote,commandId:null,requiredCapabilities,resultData:null,resultSummary:'',toolMeta};
  jobs.set(job.id,job);sessions.attachJob(job.sessionId,job.id);sessions.record(job.sessionId,'toolCalls');operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+OPERATION_DEDUPE_MS});
  pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId,nodeId:job.nodeId,status:'running',route:remote?'outbound-leaf':'local',requiredCapabilities,cwd:job.cwd,script:redact(job.script),note:job.note,toolMeta:job.toolMeta});
  if(remote){const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'terminal',operationId,sessionId:job.sessionId,agentId:job.agentId,terminal:request}});job.commandId=command.commandId;job.timer=setTimeout(()=>{if(job.finishedAt)return;fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;finishJob(job,124,null);},30000+FLEET_CHANNEL_TTL_MS*2);job.timer.unref();return job;}
  Promise.resolve().then(()=>executeLocalTerminalRequest(job,request)).then(data=>{job.resultData=data;job.resultSummary=terminalResultSummary(data);finishJob(job,0,null);}).catch(error=>{job.resultData={ok:false,error:String(error?.message||error),status:Number(error?.status)||500};job.resultSummary='error · '+redact(String(error?.message||error));emitStream(job,'stderr',Buffer.from(String(error?.message||error)+'\n'));finishJob(job,1,null);});return job;
}

async function executeLocalTerminalRequest(job,request){
  const owner={accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId},op=String(request.op||'');
  if(!hostEffectiveCapabilities().includes('terminal'))throw new DeviceError('local_host_capability_missing',409);
  if(op==='start'){
    const cwd=path.resolve(String(request.cwd||os.homedir()));let stat;try{stat=fs.statSync(cwd);}catch{}if(!stat?.isDirectory())throw new Error('cwd_not_directory');
    const shellSpec=HOST_PLATFORM_ADAPTER.terminalFor({shell:request.shell});
    return {ok:true,operation:'start',terminal:NATIVE_TERMINALS.start({...owner,shellSpec,cwd,cols:request.cols,rows:request.rows,term:request.term,env:{GPT_OPERATOR_ACCOUNT:job.accountId,GPT_OPERATOR_DEVICE:job.deviceId,GPT_OPERATOR_NODE:job.nodeId,GPT_OPERATOR_SESSION:job.sessionId}})};
  }
  if(op==='input')return {ok:true,operation:'input',terminal:NATIVE_TERMINALS.input(request.terminalId,owner,{data:request.data})};
  if(op==='output')return {ok:true,operation:'output',...NATIVE_TERMINALS.output(request.terminalId,owner,{offset:request.offset,limit:request.limit})};
  if(op==='resize')return {ok:true,operation:'resize',terminal:NATIVE_TERMINALS.resize(request.terminalId,owner,{cols:request.cols,rows:request.rows})};
  if(op==='signal')return {ok:true,operation:'signal',terminal:NATIVE_TERMINALS.signal(request.terminalId,owner,{signal:request.signal})};
  if(op==='stop')return {ok:true,operation:'stop',terminal:NATIVE_TERMINALS.stop(request.terminalId,owner,{force:Boolean(request.force)})};
  if(op==='list')return {ok:true,operation:'list',terminals:NATIVE_TERMINALS.list(owner)};
  throw new Error('terminal_operation_unsupported');
}

async function startSearchOperation(payload,requestId){
  const operationId=String(payload.operationId||'').trim();if(!/^[A-Za-z0-9._:-]{16,128}$/.test(operationId))throw new Error('invalid_operation_id');
  const agentId=String(payload.agentId||'').trim(),session=sessions.ensure(String(payload.sessionId||''),{agentId});requireDeviceConnection(session.deviceId);
  if(payload.nodeId!=null&&String(payload.nodeId)!==session.nodeId)throw new SessionError('session_target_mismatch',409);
  const request=payload.search&&typeof payload.search==='object'&&!Array.isArray(payload.search)?payload.search:null;if(!request)throw new Error('search_request_required');
  const remote=session.nodeId!==NODE_ID,requiredCapabilities=['filesystem'];
  if(remote){const route=targetRoute(session.nodeId,session.accountId);if(route.deviceId!==session.deviceId)throw new SessionError('session_target_mismatch',409);if(!route.capabilities.includes('filesystem'))throw new FleetError('target_node_capability_missing',409);}else if(!hostEffectiveCapabilities().includes('filesystem'))throw new DeviceError('local_host_capability_missing',409);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({request,sessionId:session.id,nodeId:session.nodeId})).digest('hex'),existing=operationDedupe.get(operationId);
  if(existing){if(existing.fingerprint!==fingerprint)throw new Error('operation_id_conflict');const prior=jobs.get(existing.jobId);if(prior)return prior;operationDedupe.delete(operationId);}
  const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:fingerprint,accountId:session.accountId,deviceId:session.deviceId,sessionId:session.id,agentId:session.agentId,nodeId:session.nodeId,note:`native-search:${String(request.op||'unknown')}`,cwd:String(request.path||''),script:'',status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:createAccumulator(),stderr:createAccumulator(),waiters:[],pid:null,timer:null,remote,commandId:null,requiredCapabilities,resultData:null};
  jobs.set(job.id,job);sessions.attachJob(job.sessionId,job.id);sessions.record(job.sessionId,'toolCalls');operationDedupe.set(operationId,{jobId:job.id,fingerprint,expiresAt:Date.now()+OPERATION_DEDUPE_MS});
  pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId,nodeId:job.nodeId,status:'running',route:remote?'outbound-leaf':'local',requiredCapabilities,note:job.note});
  if(remote){const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'search',operationId,sessionId:job.sessionId,agentId:job.agentId,search:request}});job.commandId=command.commandId;job.timer=setTimeout(()=>{if(job.finishedAt)return;fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;finishJob(job,124,null);},30000+FLEET_CHANNEL_TTL_MS*2);job.timer.unref();return job;}
  Promise.resolve().then(()=>executeLocalSearchRequest(job,request)).then(data=>{job.resultData=data;finishJob(job,0,null);}).catch(error=>{job.resultData={ok:false,error:String(error?.message||error),status:Number(error?.status)||500};emitStream(job,'stderr',Buffer.from(String(error?.message||error)+'\n'));finishJob(job,1,null);});return job;
}

async function executeLocalSearchRequest(job,request){
  const owner={accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId},op=String(request.op||'');
  if(!hostEffectiveCapabilities().includes('filesystem'))throw new DeviceError('local_host_capability_missing',409);
  if(op==='start'){const policy=filesystemPolicy();return {ok:true,operation:'start',search:await NATIVE_SEARCHES.start({...owner,path:request.path,searchType:request.searchType,pattern:request.pattern,literalSearch:Boolean(request.literalSearch),ignoreCase:request.ignoreCase!==false,filePattern:request.filePattern,contextLines:request.contextLines,maxResults:request.maxResults,readRoots:policy.readRoots})};}
  if(op==='results')return {ok:true,operation:'results',...NATIVE_SEARCHES.results(request.searchId,owner,{offset:request.offset,limit:request.limit})};
  if(op==='cancel')return {ok:true,operation:'cancel',search:NATIVE_SEARCHES.cancel(request.searchId,owner)};
  throw new Error('search_operation_unsupported');
}

async function waitForJob(job, waitMs) {
  if (job.finishedAt || waitMs <= 0) return;
  await Promise.race([
    new Promise(resolve => job.waiters.push(resolve)),
    new Promise(resolve => setTimeout(resolve, waitMs))
  ]);
}

function logFilesOldestFirst() {
  const candidates = [
    `${LOG_FILE}.3.gz`, `${LOG_FILE}.3`, `${LOG_FILE}.2.gz`, `${LOG_FILE}.2`,
    `${LOG_FILE}.1.gz`, `${LOG_FILE}.1`, LOG_FILE
  ];
  return candidates.filter(file => fs.existsSync(file));
}

function readLogText(file) {
  const data = fs.readFileSync(file);
  return file.endsWith('.gz') ? zlib.gunzipSync(data).toString('utf8') : data.toString('utf8');
}

function jobOwnerFromDisk(jobId) {
  for (const file of logFilesOldestFirst()) {
    for (const line of readLogText(file).split('\n')) {
      if (!line) continue;
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.jobId === jobId && event.type === 'job_started') return { sessionId:event.sessionId, agentId:event.agentId || null, nodeId:event.nodeId || 'arm' };
    }
  }
  return null;
}
function assertDiskJobOwner(jobId, agentId) {
  const owner=jobOwnerFromDisk(jobId);
  if (!owner) return null;
  if (!agentId || owner.agentId !== agentId) throw new SessionError('session_owner_mismatch',409);
  return owner;
}

function fullOutputFromDisk(jobId, stream) {
  let output = '';
  for (const file of logFilesOldestFirst()) {
    for (const line of readLogText(file).split('\n')) {
      if (!line) continue;
      let event;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.jobId === jobId && event.type === stream && event.chunk) output += event.chunk;
    }
  }
  return output;
}
function sessionStatsFromDisk(hours = 168) {
  const cutoff = Date.now() - Math.max(1, Math.min(Number(hours) || 168, 24 * 90)) * 3600000;
  const bySession = new Map();
  const get = id => {
    if (!bySession.has(id)) bySession.set(id, { sessionId:id, agentId:'', nodeId:'arm', firstSeenAt:null, lastSeenAt:null, label:'', workspace:'', opens:0, resumes:0, expires:0, closes:0, holdStarts:0, holdReleases:0, toolCalls:0, execCalls:0, jobReads:0, outputReads:0 });
    return bySession.get(id);
  };
  for (const file of logFilesOldestFirst()) {
    for (const line of readLogText(file).split('\n')) {
      if (!line) continue;
      let e; try { e=JSON.parse(line); } catch { continue; }
      const at=Date.parse(e.at || e.ts || 0); if (!Number.isFinite(at) || at < cutoff || !e.sessionId) continue;
      const row=get(e.sessionId); row.firstSeenAt=row.firstSeenAt==null?at:Math.min(row.firstSeenAt,at); row.lastSeenAt=Math.max(row.lastSeenAt||0,at);
      if (e.type==='session_opened') { row.opens++; row.label=e.label||row.label; row.workspace=e.workspace||row.workspace; row.agentId=e.agentId||row.agentId||''; row.nodeId=e.nodeId||row.nodeId||'arm'; }
      else if (e.type==='session_resumed') row.resumes++;
      else if (e.type==='session_expired') row.expires++;
      else if (e.type==='session_closed') row.closes++;
      else if (e.type==='session_hold_started') row.holdStarts++;
      else if (e.type==='session_hold_released') row.holdReleases++;
      else if (e.type==='session_activity' && e.action in row) row[e.action]++;
    }
  }
  const sessions=[...bySession.values()].sort((a,b)=>(b.lastSeenAt||0)-(a.lastSeenAt||0));
  const totals=sessions.reduce((a,s)=>{ for (const k of ['opens','resumes','expires','closes','holdStarts','holdReleases','toolCalls','execCalls','jobReads','outputReads']) a[k]=(a[k]||0)+s[k]; return a; },{sessions:sessions.length});
  return { hours:Math.max(1, Math.min(Number(hours)||168,24*90)), totals, sessions };
}

function backfillUsageIfNeeded(){
  if(!usage.isEmpty()){usage.reconcileConnections(connections.list());return {backfilled:false};}
  const events=[];
  for(const file of logFilesOldestFirst()) for(const line of readLogText(file).split('\n')){if(!line)continue;try{events.push(JSON.parse(line));}catch{}}
  const result=usage.backfill(events);usage.reconcileConnections(connections.list());return result;
}
const usageBootstrap=backfillUsageIfNeeded();
if(usageBootstrap.backfilled) pushEvent({type:'usage_backfill_completed',accountId:ACCOUNT_ID,status:'ok',events:usageBootstrap.events,trackingSince:usageBootstrap.trackingSince});

function sendJson(res, status, value, headers={}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function accountSessionToken(req){
  return String(req.headers['x-light-account-session']||'').trim();
}
function requireAccount(req,{touch=true}={}){
  return accounts.authenticate(accountSessionToken(req),{touch});
}

function activeAccount(accountId=ACCOUNT_ID){try{return accounts.account(accountId);}catch{return {accountId,plan:ACCOUNT_PLAN,entitlement:{plan:ACCOUNT_PLAN,source:'environment',validUntil:null}};}}
function activeAccountPlan(accountId=ACCOUNT_ID){return String(activeAccount(accountId).plan||ACCOUNT_PLAN).toLowerCase();}
function hostEffectiveCapabilities(){
  try{const state=JSON.parse(fs.readFileSync(HOST_COMPANION_STATE_FILE,'utf8')),allowed=Array.isArray(state.effectiveCapabilities)?state.effectiveCapabilities:HOST_CAPABILITIES;return HOST_CAPABILITIES.filter(cap=>allowed.includes(cap));}
  catch{return [...HOST_CAPABILITIES];}
}
const PLAN_FEATURES=Object.freeze({free:{fleetWall:false,multiDeviceConsole:false},pro:{fleetWall:true,multiDeviceConsole:true},vip:{fleetWall:true,multiDeviceConsole:true}});
function planEntitlements(input){const account=typeof input==='object'&&input?input:null,key=String(account?.plan||input||'free').toLowerCase(),capMs=DEFAULT_PLAN_CONNECTION_CAPS[key]||DEFAULT_PLAN_CONNECTION_CAPS.free,validUntil=account?.entitlement?.validUntil??null,features=PLAN_FEATURES[key]||PLAN_FEATURES.free;return {plan:key,connectionLeaseMs:capMs,connectionLeaseHours:capMs/3600000,fleetWall:Boolean(features.fleetWall),multiDeviceConsole:Boolean(features.multiDeviceConsole),usageMetering:true,singleCodebase:true,validUntil,source:account?.entitlement?.source||null};}
function connectionSpec(accountId,requestedLeaseMs){const account=activeAccount(accountId),key=String(account.plan||'free').toLowerCase(),planCap=DEFAULT_PLAN_CONNECTION_CAPS[key]||DEFAULT_PLAN_CONNECTION_CAPS.free,expires=Number(account.entitlement?.validUntil),now=Date.now(),remaining=key!=='free'&&Number.isFinite(expires)&&expires>now?expires-now:planCap,cap=Math.min(planCap,remaining),requested=requestedLeaseMs==null?cap:Number(requestedLeaseMs);if(!Number.isFinite(requested)||requested<=0||requested>cap)throw new DeviceConnectionError('invalid_device_connection_lease');return {plan:key,requestedLeaseMs:requested,account};}
function revokeRuntimeForDevice(deviceId,reason){
  const why=String(reason||'owner_revoked');
  try{connections.disconnect(deviceId,why);}catch{}
  try{accessGrants.closeByDevice(deviceId,why);}catch{}
  try{pairingCodes.invalidateDevice(deviceId,why);}catch{}
  try{agentClients.removeDevice(deviceId,why);}catch{}
  try{sessions.closeByDevice(deviceId,why,{force:true});}catch{}
  try{fleetAuthority.invalidateDevice(deviceId,why);}catch{}
}
function removeRuntimeForDevice(deviceId,reason='account_owner_removed'){
  const why=String(reason||'account_owner_removed');
  revokeRuntimeForDevice(deviceId,why);
  try{connections.remove(deviceId,why);}catch{}
  try{accessGrants.purgeDevice(deviceId,why);}catch{}
  try{pairingCodes.purgeDevice(deviceId,why);}catch{}
  try{agentClients.removeDevice(deviceId,why);}catch{}
  try{fleetAuthority.invalidateDevice(deviceId,why);}catch{}
}
function closeRuntimeForAccount(accountId,reason){
  const closed=[];
  for(const device of devices.list().filter(row=>row.accountId===String(accountId||''))){revokeRuntimeForDevice(device.deviceId,reason);closed.push(device.deviceId);}
  return closed;
}
function clearMainIfMatches(accountId,deviceId,reason='main_device_unavailable'){
  try{const account=accounts.account(accountId);if(account.mainDeviceId===String(deviceId||''))return accounts.clearMainDevice(accountId,{reason});}catch{}
  return null;
}

function capabilities() {
  return {
    service: 'gpt-vps-operator', version: VERSION, accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, user: process.env.USER || 'ubuntu',
    execution: ['exec_batch', 'async_jobs', 'output_retrieval', 'managed_sessions', 'device_presence', 'device_scoped_reconnect_grace', 'device_enrollment', 'fleet_routing'],
    expectedHostCapabilities: HOST_CAPABILITIES,
    socket: SOCKET_PATH, logFile: LOG_FILE,
    presence: { ttlMs:DEVICE_PRESENCE_TTL_MS, heartbeatMs:DEVICE_HEARTBEAT_MS },
    enrollment: { ttlMs:ENROLLMENT_TTL_MS, activationUrl:ENROLLMENT_ACTIVATION_URL, signer:enrollments.signerInfo(), keyAlgorithm:'Ed25519', oneTimeCode:true, signedHeartbeat:true },
    fleet: { hubNodeId:NODE_ID, outboundLeafChannel:true, explicitTargetRouting:true, silentFallback:false, channelTtlMs:FLEET_CHANNEL_TTL_MS, commandLeaseMs:FLEET_COMMAND_LEASE_MS, maxQueuedPerNode:FLEET_MAX_QUEUED_PER_NODE },
    deviceConnection: { enforced:CONNECTION_LEASE_ENFORCE, accountPlan:activeAccountPlan(), planCapsMs:DEFAULT_PLAN_CONNECTION_CAPS, reconnectGraceMinMs:15*60*1000, reconnectGraceMaxMs:60*60*1000, unlimited:false },
    sessionGracePresets: SESSION_GRACE_PRESETS,
    limits: { maxScriptBytes: 1024 * 1024, maxTimeoutMs: 7200000, memoryOutputBytes: MAX_MEMORY_OUTPUT,
      ringBytes: MAX_RING_BYTES, ringHardCapBytes:RING_HARD_CAP_BYTES, ringAgeMs:MAX_RING_AGE_MS, ringEvents: MAX_RING_EVENTS, diskFlushMs:DISK_FLUSH_MS, diskBatchBytes:DISK_BATCH_BYTES, jobCacheBytes: MAX_JOB_CACHE_BYTES, jobCacheAgeMs: MAX_JOB_CACHE_AGE_MS, operationDedupeMs: OPERATION_DEDUPE_MS,
      sessionGraceMs: SESSION_IDLE_MS, sessionMinGraceMs:SESSION_MIN_IDLE_MS, sessionMaxGraceMs:SESSION_MAX_IDLE_MS, sessionActiveWindowMs:SESSION_ACTIVE_WINDOW_MS, sessionHistoryMs: SESSION_HISTORY_MS, maxActiveSessions: MAX_ACTIVE_SESSIONS }
  };
}

function recentEvents(limit = 500, deviceId = null) {
  pruneRing();
  const n = Math.max(1, Math.min(Number(limit) || 500, MAX_RING_EVENTS));
  const did = deviceId == null ? null : String(deviceId);
  const rows = did ? ring.map(item => item.event).filter(event => String(event.deviceId || '') === did) : ring.map(item => item.event);
  return rows.slice(-n);
}

function routingViewForDevice(device) {
  if (device.nodeId === NODE_ID) return { mode:'local', state:'online', draining:false, sessionCeiling:MAX_ACTIVE_SESSIONS, queuedCommands:0, inFlightCommands:0 };
  try { return { mode:'outbound-leaf', ...fleet.view(device.nodeId) }; }
  catch { return { mode:'outbound-leaf', state:'offline', draining:false, sessionCeiling:null, queuedCommands:0, inFlightCommands:0, channelTtlMs:FLEET_CHANNEL_TTL_MS }; }
}
function policyViewForDevice(device) {
  if (device.nodeId===NODE_ID) return null;
  try { return enrollments.policyView(device.deviceId); } catch { return null; }
}
function connectionViewForDevice(deviceId) {
  const view=connections.get(deviceId);
  return { ...view, enforced:CONNECTION_LEASE_ENFORCE };
}
function requireDeviceConnection(deviceId) {
  if (!CONNECTION_LEASE_ENFORCE) return connections.get(deviceId);
  return connections.assertConnected(deviceId);
}
function deviceView(device) { return { ...device, effectiveCapabilities:device.nodeId===NODE_ID?hostEffectiveCapabilities():[...(device.capabilities||[])], routing:routingViewForDevice(device), policy:policyViewForDevice(device), connection:connectionViewForDevice(device.deviceId), compatibility:compatibilityFor(device) }; }
function allDeviceViews() { return devices.list({ activeSessionsForNode:nodeId => sessions.activeCountByNode(nodeId) }).map(deviceView); }
function queueHelperUpdate(deviceId,{source='remote-owner'}={}) {
  const device=devices.get(deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});if(device.nodeId===NODE_ID)throw new DeviceError('helper_update_hub_not_client',409);const route=targetRoute(device.nodeId,device.accountId),updateSource=String(source||'remote-owner').slice(0,40);
  const agentId=`agent-update-${crypto.randomBytes(8).toString('hex')}`,openId=`open-update-${crypto.randomBytes(8).toString('hex')}`;let session;
  try{session=sessions.open({agentId,openId,label:'client update',workspace:'',gracePreset:'30m',nodeId:route.nodeId,deviceId:route.deviceId,accountId:route.accountId,maxActiveForNode:route.sessionCeiling});const operationId=`client-update-${crypto.randomBytes(8).toString('hex')}`,requestId=`update-${crypto.randomUUID()}`;
    const job={id:crypto.randomUUID(),requestId,operationId,operationFingerprint:null,accountId:session.accountId,deviceId:session.deviceId,sessionId:session.sessionId,agentId:session.agentId,nodeId:session.nodeId,note:`${updateSource} requested helper client update`,cwd:'',script:'request signed client update',status:'running',startedAt:Date.now(),finishedAt:null,exitCode:null,signal:null,timedOut:false,stdout:createAccumulator(),stderr:createAccumulator(),waiters:[],pid:null,timer:null,remote:true,commandId:null,requiredCapabilities:[],resultData:null,autoCloseSession:true};
    jobs.set(job.id,job);sessions.attachJob(job.sessionId,job.id);sessions.record(job.sessionId,'toolCalls');pushEvent({type:'job_started',jobId:job.id,requestId,operationId,accountId:job.accountId,deviceId:job.deviceId,sessionId:job.sessionId,agentId:job.agentId,nodeId:job.nodeId,status:'running',route:'outbound-leaf',requiredCapabilities:[],note:job.note});
    const command=fleet.enqueue({accountId:job.accountId,deviceId:job.deviceId,nodeId:job.nodeId,jobId:job.id,payload:{type:'update',operationId,sessionId:job.sessionId,agentId:job.agentId,update:{op:'request',source:updateSource}}});job.commandId=command.commandId;job.timer=setTimeout(()=>{if(job.finishedAt)return;fleet.abandon(job.commandId,'remote_result_timeout');job.timedOut=true;finishJob(job,124,null);},60000+FLEET_CHANNEL_TTL_MS*2);job.timer.unref();pushEvent({type:'device_update_requested',accountId:device.accountId,deviceId:device.deviceId,nodeId:device.nodeId,sessionId:session.sessionId,agentId,jobId:job.id,status:'queued',source:updateSource});return {accepted:true,deviceId:device.deviceId,nodeId:device.nodeId,sessionId:session.sessionId,agentId,source:updateSource,job:jobView(job)};
  }catch(error){if(session?.sessionId){try{sessions.close(session.sessionId,agentId);}catch{}}throw error;}
}

function queueSignedUpdate(deviceId) {
  const device=devices.get(deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
  if(device.nodeId===NODE_ID||device.platform!=='linux')throw new DeviceError('maintenance_update_unsupported_platform',409);
  const route=targetRoute(device.nodeId,device.accountId),requiredCapabilities=['sudo-on-demand','systemctl'];
  const missing=requiredCapabilities.filter(cap=>!route.capabilities.includes(cap));
  if(missing.length)throw new FleetError('target_node_capability_missing',409);
  const agentId=`agent-maintenance-${crypto.randomBytes(8).toString('hex')}`;
  const openId=`open-maintenance-${crypto.randomBytes(8).toString('hex')}`;
  let session;
  try {
    session=sessions.open({agentId,openId,label:'signed client update',workspace:'/home/ubuntu',gracePreset:'30m',nodeId:route.nodeId,deviceId:route.deviceId,accountId:route.accountId,maxActiveForNode:route.sessionCeiling});
    const operationId=`maintenance-update-${crypto.randomBytes(8).toString('hex')}`;
    const requestId=`maintenance-${crypto.randomUUID()}`;
    const job=startJob({operationId,script:'sudo -n systemctl start --no-block gpt-operator-agent-update.service',cwd:'/home/ubuntu',timeoutMs:15_000,sessionId:session.sessionId,agentId,nodeId:route.nodeId,requiredCapabilities,note:'owner requested signed client update'},requestId);
    job.autoCloseSession=true;
    pushEvent({type:'device_maintenance_update_requested',accountId:device.accountId,deviceId:device.deviceId,nodeId:device.nodeId,sessionId:session.sessionId,agentId,jobId:job.id,status:'queued'});
    return {accepted:true,deviceId:device.deviceId,nodeId:device.nodeId,sessionId:session.sessionId,agentId,job:jobView(job)};
  } catch(error) {
    if(session?.sessionId){try{sessions.close(session.sessionId,agentId);}catch{}}
    throw error;
  }
}
function targetRoute(requestedNodeId, accountId=ACCOUNT_ID) {
  const nodeId=String(requestedNodeId || NODE_ID).trim(), aid=String(accountId||ACCOUNT_ID).trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(nodeId)) throw new DeviceError('invalid_node_id');
  if (nodeId===NODE_ID) { if(aid!==ACCOUNT_ID)throw new DeviceError('target_node_account_mismatch',403);requireDeviceConnection(DEVICE_ID); return { accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, mode:'local', sessionCeiling:MAX_ACTIVE_SESSIONS, capabilities:hostEffectiveCapabilities(), state:'online', draining:false }; }
  const device=devices.getByNodeId(nodeId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
  if (device.accountId!==aid) throw new DeviceError('target_node_account_mismatch',403);
  if (device.state!=='online') throw new DeviceError('target_node_offline',409);
  requireDeviceConnection(device.deviceId);
  const route=fleet.assertRoutable(nodeId,{accountId:aid,deviceId:device.deviceId});
  const binding=enrollments.binding(device.deviceId), allowed=new Set(binding.approvedCapabilities||[]);
  return { ...route, capabilities:(route.capabilities||[]).filter(cap=>allowed.has(cap)), mode:'outbound-leaf' };
}
class DeviceChannelRateLimitError extends Error {
  constructor(lane,retryAfterSeconds){super('rate_limited');this.status=429;this.scope=`device-channel-${lane}`;this.retryAfterSeconds=retryAfterSeconds;}
}
function trustedChannelLane(action){
  if(['poll','result','update-report'].includes(action))return 'runtime';
  if(['status','activity','fleet-intent','fleet-authority','fleet-status','fleet-devices','fleet-sessions','fleet-activity'].includes(action))return 'observer';
  return 'control';
}
function enforceTrustedChannelRate(deviceId,action,now=Date.now()){
  const lane=trustedChannelLane(action),limit=lane==='runtime'?DEVICE_CHANNEL_RUNTIME_LIMIT:lane==='observer'?DEVICE_CHANNEL_OBSERVER_LIMIT:DEVICE_CHANNEL_CONTROL_LIMIT;
  const minute=Math.floor(now/60000),key=`${lane}:${deviceId}`,current=trustedChannelRateBuckets.get(key),state=current?.minute===minute?current:{minute,count:0};
  state.count++;trustedChannelRateBuckets.set(key,state);
  if(state.count>limit)throw new DeviceChannelRateLimitError(lane,Math.max(1,60-Math.floor((now%60000)/1000)));
}
function verifiedChannelContext(body, action) {
  const payload=body?.payload;
  if (!payload || typeof payload!=='object' || Array.isArray(payload)) throw new EnrollmentError('invalid_device_channel_payload');
  const proof=enrollments.verifyChannel(body,action,payload), binding=proof.binding;
  const account=binding.accountId===ACCOUNT_ID?activeAccount(binding.accountId):accounts.account(binding.accountId);if((account.status||'active')!=='active')throw new EnrollmentError('device_account_disabled',403);
  const device=devices.get(binding.deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
  if (device.accountId!==binding.accountId || device.publicIdentityKey!==binding.publicIdentityKey) throw new EnrollmentError('device_binding_mismatch',403);
  enforceTrustedChannelRate(device.deviceId,action);
  return {payload,proof,binding,device};
}
function fleetEligibility(ctx){
  const account=accounts.account(ctx.binding.accountId),entitlements=planEntitlements(account),compatibility=compatibilityFor(ctx.device);
  if(!entitlements.fleetWall||!entitlements.multiDeviceConsole)throw new FleetAuthorityError('fleet_entitlement_required',403);
  if(!account.mainDeviceId||account.mainDeviceId!==ctx.device.deviceId){fleetAuthority.invalidateDevice(ctx.device.deviceId,'main_device_mismatch');throw new FleetAuthorityError('fleet_main_device_required',403);}
  if(ctx.device.state==='revoked')throw new FleetAuthorityError('fleet_main_device_revoked',403);
  if(!compatibility.supported)throw new FleetAuthorityError(compatibility.status,409);
  return {account,entitlements,compatibility};
}
function verifiedFleetContext(ctx){
  const {account,entitlements}=fleetEligibility(ctx),token=String(ctx.payload.fleetToken||'');
  const lease=fleetAuthority.verify(token,{accountId:account.accountId,deviceId:ctx.device.deviceId,publicKeySha256:ctx.binding.publicKeySha256});
  return {...ctx,account,entitlements,lease};
}
function fleetTarget(ctx,deviceId){
  const targetId=String(deviceId||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,128}$/.test(targetId))throw new FleetAuthorityError('invalid_fleet_target');
  const device=devices.get(targetId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});
  if(device.accountId!==ctx.account.accountId)throw new FleetAuthorityError('fleet_target_account_mismatch',403);
  if(device.state==='revoked')throw new FleetAuthorityError('fleet_target_revoked',409);
  return device;
}
function wakeDeviceChannelForDevice(deviceId){
  if(!deviceId)return false;
  try{const device=devices.get(deviceId,{activeSessionsForNode:id=>sessions.activeCountByNode(id)});fleet.wake(device.nodeId||device.deviceId);return true;}catch{return false;}
}
function verifiedLeafCapabilities(value,binding,reportedRevision=0) {
  const reported=[];
  for (const raw of Array.isArray(value)?value:[]) {
    const item=String(raw||'').trim();
    if (!/^[A-Za-z0-9._:-]{1,80}$/.test(item)) throw new EnrollmentError('invalid_device_capability');
    if (!reported.includes(item)) reported.push(item);
  }
  const currentRevision=Math.max(1,Number(binding.policyRevision)||1), stale=currentRevision>1 && Number(reportedRevision||0)<currentRevision;
  const extras=reported.filter(item=>!binding.approvedCapabilities.includes(item));
  if (extras.length && !stale) throw new EnrollmentError('device_capability_escalation',403);
  const out=reported.filter(item=>binding.approvedCapabilities.includes(item)).sort();
  if (!out.length) throw new EnrollmentError('device_capabilities_required');
  return out;
}

const routeDeps=()=>({
  ACCOUNT_ID,AccountError,AgentClientRegistryError,CLIENT_BACKWARD_RELEASES,CONNECTION_LEASE_ENFORCE,
  DEVICE_ID,DeviceAccessGrantError,DeviceConnectionError,DevicePairingRegistryError,EnrollmentError,
  FleetAuthorityError,FleetError,MAX_ACTIVE_SESSIONS,MAX_MEMORY_OUTPUT,MAX_RING_EVENTS,
  MIN_SUPPORTED_CLIENT_VERSION,NODE_ID,SESSION_GRACE_PRESETS,SESSION_IDLE_MS,SESSION_MAX_IDLE_MS,
  SESSION_MIN_IDLE_MS,VERSION,accessGrants,accountSessionToken,accounts,
  agentClients,allDeviceViews,applyDeviceTelemetry,assertDiskJobOwner,capabilities,
  clearMainIfMatches,clientCompatibility,closeRuntimeForAccount,compatibilityFor,connectionSpec,
  connectionViewForDevice,connections,decryptEnvelope,deviceView,devices,
  emitStream,enrollments,finishJob,fleet,fleetAuthority,
  fleetEligibility,fleetTarget,flushDiskRecords,fs,fullOutputFromDisk,
  ingressTelemetry,jobView,jobs,licenses,normalizeUpdateReport,
  pairingCodes,planEntitlements,pruneRing,pushEvent,queueHelperUpdate,
  queueSignedUpdate,readJson,reapAccessGrants,recentEvents,redact,
  removeRuntimeForDevice,requireAccount,requireDeviceConnection,revokeRuntimeForDevice,ring,
  ringBytes,sendJson,sessionStatsFromDisk,sessions,sseClients,
  startFsOperation,startJob,startProcessOperation,startScpOperation,startSearchOperation,
  startTerminalOperation,targetRoute,terminalResultSummary,usage,verifiedChannelContext,
  verifiedFleetContext,verifiedLeafCapabilities,waitForJob,wakeDeviceChannelForDevice,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://operator.local');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, ...capabilities() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      return sendJson(res, 200, { ok: true, ...capabilities() });
    }
    await handleAccountRoutes(req,res,url,routeDeps());
    if(res.headersSent)return;
    await handleDeviceChannelRoutes(req,res,url,routeDeps());
    if(res.headersSent)return;
    await handleRuntimeRoutes(req,res,url,routeDeps());
    if(res.headersSent)return;
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    const message = error?.message || 'internal_error';
    pushEvent({ type: 'executor_error', status: 'error', detail: redact(message) });
    const status = error instanceof SessionError || error instanceof DeviceError || error instanceof EnrollmentError || error instanceof FleetError || error instanceof DeviceConnectionError || error instanceof DeviceAccessGrantError || error instanceof DevicePairingRegistryError || error instanceof AgentClientRegistryError || error instanceof AccountError || error instanceof LicenseKeyError || error instanceof FleetAuthorityError || error instanceof DeviceChannelRateLimitError ? error.status : ['invalid_envelope', 'expired_envelope', 'replay_detected', 'unknown_kid', 'invalid_envelope_auth', 'unsupported_action'].includes(message) ? 401 : message === 'operation_id_conflict' ? 409 : 400;
    const limited=error instanceof DeviceChannelRateLimitError;
    return sendJson(res, status, { ok: false, error: message, ...(limited?{scope:error.scope,retryAfterSeconds:error.retryAfterSeconds}:{}) }, limited?{'retry-after':String(error.retryAfterSeconds)}:{});
  }
});

if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
server.listen(SOCKET_PATH, () => {
  fs.chmodSync(SOCKET_PATH, 0o660);
  console.log(`gpt-vps-operator v${VERSION} listening on ${SOCKET_PATH}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[operator] ${signal}, shutting down`);
  clearInterval(deviceHeartbeat);
  clearInterval(connectionReaper);
  try { devices.markOffline(DEVICE_ID, signal.toLowerCase()); } catch {}
  for (const res of sseClients) { try { res.end(); } catch {} }
  sseClients.clear();
  for (const job of jobs.values()) {
    if (job.status === 'running' && job.pid) {
      try { process.kill(job.pid, 'SIGTERM'); } catch {}
    }
  }
  void flushDiskRecords().finally(()=>server.close(()=>process.exit(0)));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
