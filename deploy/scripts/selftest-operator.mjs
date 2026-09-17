import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createOperatorCryptoFixture } from './selftest-crypto-fixture.mjs';
const root = new URL('../..', import.meta.url).pathname;
const run = `${process.pid}-${Date.now()}`;
const socketPath = `/tmp/gpt-vps-operator-selftest-${run}.sock`;
const logDir = `/tmp/gpt-vps-operator-selftest-${run}-log`;
const stateDir = `/tmp/gpt-vps-operator-selftest-${run}-state`;
fs.rmSync(socketPath, { force:true });
fs.rmSync(logDir, { recursive:true, force:true });
fs.mkdirSync(logDir, { recursive:true });
const cryptoFixture=createOperatorCryptoFixture(stateDir);
const child = spawn(process.execPath, [`${root}/operator-host/executor.mjs`], {
  cwd: root,
  env: { ...process.env, OPERATOR_SOCKET:socketPath, OPERATOR_LOG_DIR:logDir,OPERATOR_STATE_DIR:'/tmp/gpt-vps-operator-selftest-state',
    OPERATOR_KEY_FILE:cryptoFixture.privateFile, OPERATOR_STATE_DIR:stateDir },
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
const opened=await request('POST','/v1/sessions/open',{agentId,openId:'selftest-operator-open-v05',label:'operator regression',workspace:root});
if(opened.status!==200) throw new Error('session_open_failed'); const sessionId=opened.json.session.sessionId;
const envelope = cryptoFixture.seal({ action:'exec_batch', operationId:'selftest-operator-v05',
  script:"pwd; printf 'selftest-ok\\n'", sessionId, agentId, note:'encrypted regression', waitMs:5000, timeoutMs:10000 });
const first = await request('POST','/v1/execute',envelope);
if (first.status !== 200 || first.json.job?.exitCode !== 0) throw new Error('execute_failed');
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
if (out.status !== 200 || !out.json.output.includes('selftest-ok') || !out.json.output.includes(root.replace(/\/$/,''))) throw new Error('output_retrieval_failed');
const expectedWorkspace=root.replace(/\/$/,'');
const processStart=await request('POST','/v1/process',cryptoFixture.seal({action:'process',operationId:'selftest-operator-process-v05',sessionId,agentId,process:{op:'start',script:"pwd; sleep 0.05; printf 'process-ok\\n'"},waitMs:5000}));
if(processStart.status!==200||!processStart.json.ok||processStart.json.data?.process?.cwd!==expectedWorkspace)throw new Error(`process_workspace_failed:${processStart.status}:${processStart.json.data?.process?.cwd||''}`);
const terminalStart=await request('POST','/v1/terminal',cryptoFixture.seal({action:'terminal',operationId:'selftest-operator-terminal-v05',sessionId,agentId,terminal:{op:'start',shell:'bash',cols:80,rows:24},waitMs:5000}));
const terminalId=terminalStart.json.data?.terminal?.terminalId;
if(terminalStart.status!==200||!terminalStart.json.ok||terminalStart.json.data?.terminal?.cwd!==expectedWorkspace||!terminalId)throw new Error(`terminal_workspace_failed:${terminalStart.status}:${terminalStart.json.data?.error||terminalStart.json.data?.terminal?.cwd||''}`);
const terminalStop=await request('POST','/v1/terminal',cryptoFixture.seal({action:'terminal',operationId:'selftest-operator-terminal-stop-v05',sessionId,agentId,terminal:{op:'stop',terminalId,force:true},waitMs:5000}));
if(terminalStop.status!==200||!terminalStop.json.ok)throw new Error('terminal_stop_failed');
const audit = fs.readFileSync(`${logDir}/operations.jsonl`,'utf8');
if (!audit.includes('job_started') || !audit.includes('job_finished')) throw new Error('audit_failed');
console.log(JSON.stringify({ ok:true, execute:first.status, replay:replay.json.error,
  tamper:bad.json.error, output:out.json.output.trim(), processWorkspace:processStart.json.data.process.cwd, terminalWorkspace:terminalStart.json.data.terminal.cwd, cache:caps.json.limits }, null, 2));
child.kill('SIGTERM');
await sleep(100);
fs.rmSync(socketPath,{force:true}); fs.rmSync(logDir,{recursive:true,force:true}); fs.rmSync(stateDir,{recursive:true,force:true});
