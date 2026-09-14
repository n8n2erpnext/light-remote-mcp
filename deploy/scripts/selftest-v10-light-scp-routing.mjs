import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const operator=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');
const agent=fs.readFileSync(path.join(root,'device-agent/operator-agent.mjs'),'utf8');
const ops=['upload-begin','upload-chunk','upload-commit','download-begin','download-chunk','status','cancel'];

assert.ok(operator.includes('async function startScpOperation'),'operator_scp_dispatch_missing');
assert.ok(operator.includes("payload:{type:'scp'"),'operator_fleet_scp_payload_missing');
assert.ok(operator.includes("url.pathname === '/v1/scp'"),'operator_scp_route_missing');
assert.ok(operator.includes("'exec_batch','fs','process','search','scp'"),'device_access_scp_allowlist_missing');
assert.ok(operator.includes("payload.action==='scp'?await startScpOperation"),'device_access_scp_dispatch_missing');
assert.ok(agent.includes("if(p.type==='scp')"),'leaf_scp_dispatch_missing');
assert.ok(agent.includes('executeScpCommand(state,p)'),'leaf_scp_executor_missing');
for(const op of ops){
  assert.ok(operator.includes(`op==='${op}'`),`operator_scp_op_missing:${op}`);
  assert.ok(agent.includes(`op==='${op}'`),`leaf_scp_op_missing:${op}`);
}
const recovery=agent.indexOf("if(existing?.state==='running')");
const scpBranch=agent.indexOf("if(p.type==='scp')");
assert.ok(recovery>=0&&scpBranch>recovery,'leaf_recovery_must_precede_scp_dispatch');
assert.ok(agent.includes('execution was not repeated'),'leaf_incomplete_command_replay_guard_missing');
console.log('v10-light-scp-operator-fleet-leaf-routing=PASS');
console.log('v10-light-scp-crash-replay-guard=PASS');
