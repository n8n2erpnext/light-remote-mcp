import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
import { ipcEndpoint, removeIpcEndpoint, waitForIpc } from './selftest-ipc.mjs';
const root = fileURLToPath(new URL('../..',import.meta.url));
const run = `${process.pid}-${Date.now()}`;
const socketPath = ipcEndpoint('gpt-vps-operator-selftest');
const logDir = path.join(os.tmpdir(),'gpt-vps-operator-selftest-'+run+'-log');
const stateDir = path.join(os.tmpdir(),'gpt-vps-operator-selftest-'+run+'-state');
removeIpcEndpoint(socketPath);
fs.rmSync(logDir, { recursive:true, force:true });
fs.mkdirSync(logDir, { recursive:true });
const cryptoFixture=createOperatorCryptoFixture(stateDir);
const child = spawn(process.execPath, [`${root}/operator-host/executor.mjs`], {
  cwd: root,
  env: { ...process.env, OPERATOR_SOCKET:socketPath, OPERATOR_LOG_DIR:logDir,
    OPERATOR_KEY_FILE:cryptoFixture.privateFile, OPERATOR_STATE_DIR:stateDir },
  stdio:['ignore','pipe','pipe']
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
await waitForIpc(socketPath,{attempts:80,delayMs:50,error:'executor_socket_not_ready'});
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
const envelope = cryptoFixture.seal({ action:'exec_batch', operationId:'selftest-operator-v05', cwd:root,
  script:process.platform==='win32'?"Write-Output 'selftest-ok'":"printf 'selftest-ok\\n'", sessionId, agentId, note:'encrypted regression', waitMs:5000, timeoutMs:10000 });
const first = await request('POST','/v1/execute',envelope);
if (first.status !== 200 || first.json.job?.exitCode !== 0) throw new Error('execute_failed:'+JSON.stringify({status:first.status,error:first.json.error,job:first.json.job}));
const jobId = first.json.job.jobId;
const replay = await request('POST','/v1/execute',envelope);
if (replay.status !== 401 || replay.json.error !== 'replay_detected') throw new Error('replay_guard_failed');
const tampered = cryptoFixture.seal({ action:'exec_batch', operationId:'tamper-envelope-v05', cwd:root, script:'true', sessionId, agentId });
const tamperedBytes=Buffer.from(tampered.ciphertext,'base64url');
tamperedBytes[0]^=0x01;
tampered.ciphertext=tamperedBytes.toString('base64url');
const bad = await request('POST','/v1/execute',tampered);
if (bad.status !== 401 || bad.json.error !== 'invalid_envelope_auth') throw new Error(`tamper_guard_failed:${bad.status}:${bad.json.error}`);
const out = await request('GET',`/v1/output/${jobId}?agentId=${agentId}&stream=stdout&full=1&limit=1048576`);
if (out.status !== 200 || !out.json.output.includes('selftest-ok')) throw new Error('output_retrieval_failed');
const audit = fs.readFileSync(`${logDir}/operations.jsonl`,'utf8');
if (!audit.includes('job_started') || !audit.includes('job_finished')) throw new Error('audit_failed');
console.log(JSON.stringify({ ok:true, execute:first.status, replay:replay.json.error,
  tamper:bad.json.error, output:out.json.output.trim(), cache:caps.json.limits }, null, 2));
child.kill('SIGTERM');
await sleep(100);
removeIpcEndpoint(socketPath); fs.rmSync(logDir,{recursive:true,force:true}); fs.rmSync(stateDir,{recursive:true,force:true});
