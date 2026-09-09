import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { decryptEnvelope as decryptSealedEnvelope } from './crypto.mjs';
import { spawn } from 'node:child_process';
import { SessionRegistry, SessionError, SESSION_LEASE_PRESETS } from './session-manager.mjs';
import { DeviceRegistry, DeviceError } from './device-registry.mjs';

const SOCKET_PATH = process.env.OPERATOR_SOCKET || '/run/gpt-vps-operator/operator.sock';
const KEY_FILE = process.env.OPERATOR_KEY_FILE || '/home/ubuntu/.config/gpt-vps-operator/operator.private.json';
const LOG_DIR = process.env.OPERATOR_LOG_DIR || '/var/log/gpt-vps-operator';
const LOG_FILE = path.join(LOG_DIR, 'operations.jsonl');
const STATE_DIR = process.env.OPERATOR_STATE_DIR || '/var/lib/gpt-vps-operator';
const DEVICE_STATE_FILE = path.join(STATE_DIR, 'devices.json');
const MAX_RING_BYTES = Number(process.env.OPERATOR_RING_BYTES || 16 * 1024 * 1024);
const MAX_RING_EVENTS = Number(process.env.OPERATOR_RING_EVENTS || 5000);
const MAX_MEMORY_OUTPUT = Number(process.env.OPERATOR_MEMORY_OUTPUT || 4 * 1024 * 1024);
const MAX_BODY_BYTES = Number(process.env.OPERATOR_MAX_BODY || 8 * 1024 * 1024);
const MAX_JOB_CACHE_BYTES = Number(process.env.OPERATOR_JOB_CACHE_BYTES || 64 * 1024 * 1024);
const MAX_JOB_CACHE_AGE_MS = Number(process.env.OPERATOR_JOB_CACHE_AGE_MS || 6 * 60 * 60 * 1000);
const OPERATION_DEDUPE_MS = Number(process.env.OPERATOR_DEDUPE_MS || 6 * 60 * 60 * 1000);
const SESSION_IDLE_MS = Number(process.env.OPERATOR_SESSION_IDLE_MS || 30 * 60 * 1000);
const SESSION_MIN_IDLE_MS = Number(process.env.OPERATOR_SESSION_MIN_IDLE_MS || 5 * 60 * 1000);
const SESSION_MAX_IDLE_MS = Number(process.env.OPERATOR_SESSION_MAX_IDLE_MS || 24 * 60 * 60 * 1000);
const SESSION_HISTORY_MS = Number(process.env.OPERATOR_SESSION_HISTORY_MS || 7 * 24 * 60 * 60 * 1000);
const MAX_ACTIVE_SESSIONS = Number(process.env.OPERATOR_MAX_ACTIVE_SESSIONS || 5);
const ACCOUNT_ID = String(process.env.OPERATOR_ACCOUNT_ID || 'self-hosted-local');
const DEVICE_ID = String(process.env.OPERATOR_DEVICE_ID || 'arm-local');
const NODE_ID = String(process.env.OPERATOR_NODE_ID || 'arm');
const DEVICE_NAME = String(process.env.OPERATOR_DEVICE_NAME || os.hostname());
const DEVICE_POLICY_PROFILE = String(process.env.OPERATOR_DEVICE_POLICY_PROFILE || 'self-hosted-owner');
const DEVICE_PUBLIC_KEY = String(process.env.OPERATOR_DEVICE_PUBLIC_KEY || '');
const DEVICE_PRESENCE_TTL_MS = Number(process.env.OPERATOR_DEVICE_PRESENCE_TTL_MS || 90 * 1000);
const DEVICE_HEARTBEAT_MS = Number(process.env.OPERATOR_DEVICE_HEARTBEAT_MS || 30 * 1000);
if (!Number.isFinite(DEVICE_PRESENCE_TTL_MS) || DEVICE_PRESENCE_TTL_MS < 10_000) throw new Error('invalid_device_presence_ttl');
if (!Number.isFinite(DEVICE_HEARTBEAT_MS) || DEVICE_HEARTBEAT_MS < 5_000 || DEVICE_HEARTBEAT_MS >= DEVICE_PRESENCE_TTL_MS) throw new Error('invalid_device_heartbeat');
const HOST_CAPABILITIES = ['filesystem', 'git', 'build-test', 'docker', 'lxd', 'systemctl', 'sudo-on-demand'];
const VERSION = '0.6.0-dev';

const jobs = new Map();
const operationDedupe = new Map();
const replay = new Map();
const ring = [];
const sseClients = new Set();
let ringBytes = 0;
let sequence = 0;
const sessions = new SessionRegistry({ idleMs:SESSION_IDLE_MS, minIdleMs:SESSION_MIN_IDLE_MS, maxIdleMs:SESSION_MAX_IDLE_MS, maxActive:MAX_ACTIVE_SESSIONS, historyMs:SESSION_HISTORY_MS, accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, emit:event => pushEvent(event) });
const devices = new DeviceRegistry({ stateFile:DEVICE_STATE_FILE, presenceTtlMs:DEVICE_PRESENCE_TTL_MS, emit:event => pushEvent(event) });

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

function diskRecord(event) {
  const safe = { ...event };
  for (const key of ['script', 'stdout', 'stderr', 'chunk', 'note']) {
    if (safe[key] != null) safe[key] = redact(safe[key]);
  }
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(safe)}\n`, { encoding: 'utf8' });
}

function pushEvent(input) {
  const event = { id: ++sequence, at: new Date().toISOString(), ...input };
  const encoded = JSON.stringify(event);
  const bytes = Buffer.byteLength(encoded);
  ring.push({ event, bytes });
  ringBytes += bytes;
  while (ring.length > MAX_RING_EVENTS || ringBytes > MAX_RING_BYTES) {
    const old = ring.shift();
    ringBytes -= old.bytes;
  }
  diskRecord(event);
  const frame = `id: ${event.id}\nevent: activity\ndata: ${encoded}\n\n`;
  for (const res of sseClients) res.write(frame);
  return event;
}
if (devices.loadError) pushEvent({ type:'device_registry_load_error', status:'error', detail:redact(devices.loadError) });
devices.register({ accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, displayName:DEVICE_NAME, platform:os.platform(), architecture:os.arch(), agentVersion:VERSION, publicIdentityKey:DEVICE_PUBLIC_KEY || null, capabilities:HOST_CAPABILITIES, policyProfile:DEVICE_POLICY_PROFILE });
const deviceHeartbeat = setInterval(() => { try { devices.heartbeat(DEVICE_ID); } catch (error) { console.error('[device] heartbeat failed', error?.message || error); } }, DEVICE_HEARTBEAT_MS);
deviceHeartbeat.unref();

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

function jobView(job) {
  const out = job.stdout.snapshot();
  const err = job.stderr.snapshot();
  return {
    jobId: job.id, requestId: job.requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId: job.agentId, nodeId: job.nodeId, status: job.status,
    cwd: job.cwd, script: redact(job.script), note: redact(job.note || ''), pid: job.pid || null,
    startedAt: job.startedAt, finishedAt: job.finishedAt || null, exitCode: job.exitCode,
    signal: job.signal || null, durationMs: job.finishedAt ? job.finishedAt - job.startedAt : Date.now() - job.startedAt,
    stdout: redact(out.text), stderr: redact(err.text), stdoutBytes: out.totalBytes, stderrBytes: err.totalBytes,
    outputTruncated: out.truncated || err.truncated
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
  job.exitCode = exitCode;
  job.signal = signal || null;
  job.status = exitCode === 0 ? 'ok' : job.timedOut ? 'timeout' : 'error';
  clearTimeout(job.timer);
  sessions.finishJob(job.sessionId, job.id, job.status);
  pushEvent({ type: 'job_finished', jobId: job.id, requestId: job.requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId:job.agentId, nodeId:job.nodeId,
    status: job.status, exitCode, signal: signal || null, durationMs: job.finishedAt - job.startedAt });
  for (const resolve of job.waiters.splice(0)) resolve();
  pruneJobs(job.finishedAt);
}

function emitStream(job, stream, data) {
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
  const cwd = path.resolve(String(payload.cwd || '/home/ubuntu'));
  const stat = fs.statSync(cwd);
  if (!stat.isDirectory()) throw new Error('cwd_not_directory');
  const timeoutMs = Math.max(1000, Math.min(Number(payload.timeoutMs) || 600000, 7200000));
  const requestedSessionId = String(payload.sessionId || '');
  const agentId = String(payload.agentId || '').trim();
  const session = sessions.ensure(requestedSessionId, { agentId });
  sessions.record(session.id, 'toolCalls');
  sessions.record(session.id, 'execCalls');
  const sessionId = session.id;
  const note = String(payload.note || '');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ script, cwd, timeoutMs, sessionId, note })).digest('hex');
  const existing = operationDedupe.get(operationId);
  if (existing) {
    if (existing.fingerprint !== fingerprint) throw new Error('operation_id_conflict');
    const prior = jobs.get(existing.jobId); if (prior) return prior; operationDedupe.delete(operationId);
  }
  const job = {
    id: crypto.randomUUID(), requestId, operationId, operationFingerprint: fingerprint, accountId:session.accountId, deviceId:session.deviceId, sessionId, agentId:session.agentId, nodeId:session.nodeId, note,
    cwd, script, status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, signal: null,
    timedOut: false, stdout: createAccumulator(), stderr: createAccumulator(), waiters: [], pid: null, timer: null
  };
  jobs.set(job.id, job);
  sessions.attachJob(job.sessionId, job.id);
  operationDedupe.set(operationId, { jobId: job.id, fingerprint, expiresAt: Date.now() + OPERATION_DEDUPE_MS });
  pushEvent({ type: 'job_started', jobId: job.id, requestId, operationId: job.operationId, accountId:job.accountId, deviceId:job.deviceId, sessionId: job.sessionId, agentId:job.agentId, nodeId:job.nodeId, status: 'running',
    cwd, script: redact(script), note: redact(job.note), timeoutMs });
  const child = spawn('/bin/bash', ['-lc', script], { cwd, env: { ...process.env, GPT_OPERATOR_ACCOUNT:job.accountId, GPT_OPERATOR_DEVICE:job.deviceId, GPT_OPERATOR_SESSION: job.sessionId }, stdio: ['ignore', 'pipe', 'pipe'] });
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

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
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

function capabilities() {
  return {
    service: 'gpt-vps-operator', version: VERSION, accountId:ACCOUNT_ID, deviceId:DEVICE_ID, nodeId:NODE_ID, user: process.env.USER || 'ubuntu',
    execution: ['exec_batch', 'async_jobs', 'output_retrieval', 'managed_sessions', 'device_presence', 'configurable_session_lease'],
    expectedHostCapabilities: HOST_CAPABILITIES,
    socket: SOCKET_PATH, logFile: LOG_FILE,
    presence: { ttlMs:DEVICE_PRESENCE_TTL_MS, heartbeatMs:DEVICE_HEARTBEAT_MS },
    sessionLeasePresets: SESSION_LEASE_PRESETS,
    limits: { maxScriptBytes: 1024 * 1024, maxTimeoutMs: 7200000, memoryOutputBytes: MAX_MEMORY_OUTPUT,
      ringBytes: MAX_RING_BYTES, ringEvents: MAX_RING_EVENTS, jobCacheBytes: MAX_JOB_CACHE_BYTES, jobCacheAgeMs: MAX_JOB_CACHE_AGE_MS, operationDedupeMs: OPERATION_DEDUPE_MS,
      sessionIdleMs: SESSION_IDLE_MS, sessionMinIdleMs:SESSION_MIN_IDLE_MS, sessionMaxIdleMs:SESSION_MAX_IDLE_MS, sessionHistoryMs: SESSION_HISTORY_MS, maxActiveSessions: MAX_ACTIVE_SESSIONS }
  };
}

function recentEvents(limit = 500) {
  const n = Math.max(1, Math.min(Number(limit) || 500, MAX_RING_EVENTS));
  return ring.slice(-n).map(item => item.event);
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://operator.local');
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return sendJson(res, 200, { ok: true, ...capabilities() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
      return sendJson(res, 200, { ok: true, ...capabilities() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/devices') {
      return sendJson(res, 200, { ok:true, currentDeviceId:DEVICE_ID, devices:devices.list({ activeSessionsForNode:nodeId => sessions.activeCountByNode(nodeId) }) });
    }
    const deviceMatch = url.pathname.match(/^\/v1\/devices\/([A-Za-z0-9._:-]+)$/);
    if (req.method === 'GET' && deviceMatch) {
      return sendJson(res, 200, { ok:true, device:devices.get(deviceMatch[1], { activeSessionsForNode:nodeId => sessions.activeCountByNode(nodeId) }) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/sessions/open') {
      const body = await readJson(req);
      return sendJson(res, 200, { ok:true, session:sessions.open({ openId:body.openId, agentId:body.agentId, label:body.label, workspace:body.workspace, leaseMs:body.leaseMs, leasePreset:body.leasePreset }) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/sessions') {
      return sendJson(res, 200, { ok:true, active:sessions.activeCount(), maxActive:MAX_ACTIVE_SESSIONS, defaultLeaseMs:SESSION_IDLE_MS, minLeaseMs:SESSION_MIN_IDLE_MS, maxLeaseMs:SESSION_MAX_IDLE_MS, leasePresets:SESSION_LEASE_PRESETS, sessions:sessions.list() });
    }
    if (req.method === 'GET' && url.pathname === '/v1/session-stats') {
      return sendJson(res, 200, { ok:true, ...sessionStatsFromDisk(url.searchParams.get('hours')) });
    }
    const sessionAction = url.pathname.match(/^\/v1\/sessions\/([A-Za-z0-9._:-]+)(?:\/(resume|close|touch))?$/);
    if (sessionAction) {
      const sid=sessionAction[1], action=sessionAction[2] || 'get';
      const body = req.method === 'POST' ? await readJson(req) : null;
      const aid = body?.agentId || url.searchParams.get('agentId');
      if (req.method === 'GET' && action === 'get') return sendJson(res, 200, { ok:true, session:sessions.get(sid, aid) });
      if (req.method === 'POST' && action === 'resume') return sendJson(res, 200, { ok:true, session:sessions.resume(sid, aid) });
      if (req.method === 'POST' && action === 'close') return sendJson(res, 200, { ok:true, session:sessions.close(sid, aid) });
      if (req.method === 'POST' && action === 'touch') return sendJson(res, 200, { ok:true, session:sessions.touch(sid, aid, body?.action || 'tool') });
    }
    if (req.method === 'POST' && url.pathname === '/v1/execute') {
      const envelope = await readJson(req);
      const { payload, requestId, aad, kid } = decryptEnvelope(envelope);
      if (payload.action !== 'exec_batch') throw new Error('unsupported_action');
      const job = startJob(payload, requestId);
      const waitMs = Math.max(0, Math.min(Number(payload.waitMs) || 0, 8000));
      await waitForJob(job, waitMs);
      return sendJson(res, 200, { ok: true, encryptedByKid: kid, aad, job: jobView(job) });
    }
    const jobMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]+)$/i);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      const aid = url.searchParams.get('agentId');
      if (job) { sessions.ensure(job.sessionId, { agentId:aid }); sessions.record(job.sessionId, 'toolCalls'); sessions.record(job.sessionId, 'jobReads'); }
      return job ? sendJson(res, 200, { ok: true, job: jobView(job) }) : sendJson(res, 404, { ok: false, error: 'job_not_found' });
    }
    const outputMatch = url.pathname.match(/^\/v1\/output\/([0-9a-f-]+)$/i);
    if (req.method === 'GET' && outputMatch) {
      const stream = url.searchParams.get('stream') === 'stderr' ? 'stderr' : 'stdout';
      const full = url.searchParams.get('full') === '1';
      const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit')) || MAX_MEMORY_OUTPUT, 8 * 1024 * 1024));
      const job = jobs.get(outputMatch[1]);
      const aid = url.searchParams.get('agentId');
      if (job) { sessions.ensure(job.sessionId, { agentId:aid }); sessions.record(job.sessionId, 'toolCalls'); sessions.record(job.sessionId, 'outputReads'); }
      else assertDiskJobOwner(outputMatch[1], aid);
      let text;
      if (full) text = fullOutputFromDisk(outputMatch[1], stream);
      else if (job) text = job[stream].snapshot().text;
      else text = fullOutputFromDisk(outputMatch[1], stream);
      const totalBytes = Buffer.byteLength(text);
      const slice = Buffer.from(text).subarray(offset, offset + limit).toString('utf8');
      return sendJson(res, 200, { ok: true, jobId: outputMatch[1], stream, offset, returnedBytes: Buffer.byteLength(slice),
        totalBytes, hasMore: offset + Buffer.byteLength(slice) < totalBytes, output: redact(slice) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/activity') {
      return sendJson(res, 200, { ok: true, version: VERSION, ringBytes, events: recentEvents(url.searchParams.get('limit')) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      sseClients.add(res);
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, now: new Date().toISOString(), version: VERSION })}\n\n`);
      for (const item of ring.slice(-100)) res.write(`id: ${item.event.id}\nevent: activity\ndata: ${JSON.stringify(item.event)}\n\n`);
      const timer = setInterval(() => res.write(`: keepalive ${Date.now()}\n\n`), 20000);
      req.on('close', () => { clearInterval(timer); sseClients.delete(res); });
      return;
    }
    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (error) {
    const message = error?.message || 'internal_error';
    pushEvent({ type: 'executor_error', status: 'error', detail: redact(message) });
    const status = error instanceof SessionError || error instanceof DeviceError ? error.status : ['invalid_envelope', 'expired_envelope', 'replay_detected', 'unknown_kid', 'invalid_envelope_auth', 'unsupported_action'].includes(message) ? 401 : message === 'operation_id_conflict' ? 409 : 400;
    return sendJson(res, status, { ok: false, error: message });
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
  try { devices.markOffline(DEVICE_ID, signal.toLowerCase()); } catch {}
  for (const res of sseClients) { try { res.end(); } catch {} }
  sseClients.clear();
  for (const job of jobs.values()) {
    if (job.status === 'running' && job.pid) {
      try { process.kill(job.pid, 'SIGTERM'); } catch {}
    }
  }
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
