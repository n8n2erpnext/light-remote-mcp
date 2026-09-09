import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sealOperatorPayload } = require('../../lib/operator-crypto');
const root = new URL('../..', import.meta.url).pathname;
const run = `${process.pid}-${Date.now()}`;
const socketPath = `/tmp/gpt-vps-operator-selftest-${run}.sock`;
const logDir = `/tmp/gpt-vps-operator-selftest-${run}-log`;
const stateDir = `/tmp/gpt-vps-operator-selftest-${run}-state`;
fs.rmSync(socketPath, { force:true });
fs.rmSync(logDir, { recursive:true, force:true });
fs.mkdirSync(logDir, { recursive:true });
const child = spawn(process.execPath, [`${root}/operator-host/executor.mjs`], {
  cwd: root,
  env: { ...process.env, OPERATOR_SOCKET:socketPath, OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:'/tmp/gpt-vps-operator-selftest-state',
    OPERATOR_KEY_FILE:'/home/ubuntu/.config/gpt-vps-operator/operator.private.json', OPERATOR_STATE_DIR:stateDir },
  stdio:['ignore','pipe','pipe']
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let i=0; i<80 && !fs.existsSync(socketPath); i++) await sleep(50);
if (!fs.existsSync(socketPath)) throw new Error('executor_socket_not_ready');
function request(method, target, body) {
  return new Promise((resolve,reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ socketPath, method, path:target, headers:payload ?
      { 'content-type':'application/json', 'content-length':payload.length } : {} }, res => {
      let text=''; res.on('data', c => text += c); res.on('end', () => {
        let json; try { json=JSON.parse(text); } catch { json={raw:text}; }
        resolve({ status:res.statusCode, json });
      });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
const caps = await request('GET','/v1/capabilities');
if (caps.status !== 200 || !caps.json.ok) throw new Error('capabilities_failed');
const agentId='agent-selftest-operator-v05-aaaaaaaa';
const opened=await request('POST','/v1/sessions/open',{agentId,openId:'selftest-operator-open-v05',label:'operator regression'});
if(opened.status!==200) throw new Error('session_open_failed'); const sessionId=opened.json.session.sessionId;
const envelope = sealOperatorPayload({ action:'exec_batch', operationId:'selftest-operator-v05', cwd:'/home/ubuntu',
  script:"printf 'selftest-ok\\n'", sessionId, agentId, note:'encrypted regression', waitMs:5000, timeoutMs:10000 });
const first = await request('POST','/v1/execute',envelope);
if (first.status !== 200 || first.json.job?.exitCode !== 0) throw new Error('execute_failed');
const jobId = first.json.job.jobId;
const replay = await request('POST','/v1/execute',envelope);
if (replay.status !== 401 || replay.json.error !== 'replay_detected') throw new Error('replay_guard_failed');
const tampered = sealOperatorPayload({ action:'exec_batch', operationId:'tamper-envelope-v05', cwd:'/home/ubuntu', script:'true', sessionId, agentId });
tampered.ciphertext = tampered.ciphertext.slice(0,-1) + (tampered.ciphertext.endsWith('A') ? 'B' : 'A');
const bad = await request('POST','/v1/execute',tampered);
if (bad.status !== 401 || bad.json.error !== 'invalid_envelope_auth') throw new Error('tamper_guard_failed');
const out = await request('GET',`/v1/output/${jobId}?agentId=${agentId}&stream=stdout&full=1&limit=1048576`);
if (out.status !== 200 || !out.json.output.includes('selftest-ok')) throw new Error('output_retrieval_failed');
const audit = fs.readFileSync(`${logDir}/operations.jsonl`,'utf8');
if (!audit.includes('job_started') || !audit.includes('job_finished')) throw new Error('audit_failed');
console.log(JSON.stringify({ ok:true, execute:first.status, replay:replay.json.error,
  tamper:bad.json.error, output:out.json.output.trim(), cache:caps.json.limits }, null, 2));
child.kill('SIGTERM');
await sleep(100);
fs.rmSync(socketPath,{force:true}); fs.rmSync(logDir,{recursive:true,force:true}); fs.rmSync(stateDir,{recursive:true,force:true});
