import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const need=(v,m)=>{if(!v)throw new Error(m);};
const api=read('api/operator.js'),host=read('operator-host/executor.mjs'),agent=read('device-agent/operator-agent.mjs');
const helper=read('lib/plus-tool-helper.js'),wall=read('device-agent/local-wall.mjs'),policy=read('gateway/device-policy-page.mjs');
const core=JSON.parse(read('client/core-files.json')),pkg=JSON.parse(read('package.json')),stage=read('deploy/scripts/stage-terminal-runtime.mjs');
need(api.includes("action.startsWith('terminal-')")&&api.includes("action:'terminal'"),'plus_terminal_surface_missing');
need(host.includes("payload.action==='terminal'")&&host.includes('startTerminalOperation'),'host_terminal_dispatch_missing');
need(agent.includes("p.type==='terminal'")&&agent.includes('executeTerminalCommand'),'leaf_terminal_dispatch_missing');
need(helper.includes("'terminal-start'")&&helper.includes("capability:'terminal'")&&helper.includes('platformGuide'),'tool_helper_terminal_missing');
need(wall.includes("'terminal'")&&wall.includes('Interactive terminal'),'local_wall_terminal_policy_missing');
need(policy.includes("'terminal'")&&policy.includes('Interactive terminal'),'fleet_policy_terminal_missing');
for(const source of [wall,policy]){
  const developer=source.match(/developer:\[([^\]]*)\]/)?.[1]||'';
  const infra=source.match(/infra:\[([^\]]*)\]/)?.[1]||'';
  need(!developer.includes("'terminal'"),'developer_profile_must_not_auto_grant_terminal');
  need(infra.includes("'terminal'"),'infra_profile_terminal_missing');
}
need(helper.includes('raw service-account authority')||helper.includes('underlying service-account authority'),'tool_helper_raw_terminal_authority_warning_missing');
need(core.files.some(x=>x.source==='lib/native-terminal.mjs'),'client_core_terminal_missing');
need(pkg.dependencies?.['node-pty']==='^1.1.0'||pkg.dependencies?.['node-pty']==='1.1.0','node_pty_dependency_missing');
need(pkg.dependencies?.['@homebridge/node-pty-prebuilt-multiarch']==='^0.14.1'||pkg.dependencies?.['@homebridge/node-pty-prebuilt-multiarch']==='0.14.1','linux_pty_dependency_missing');
need(stage.includes("fs.rmSync(path.join(destination,'third_party')"),'terminal_runtime_third_party_prune_missing');
need(stage.includes("'spawn-helper'")&&stage.includes('fs.chmodSync(helperPath,0o755)')&&stage.includes('terminal_runtime_spawn_helper_not_executable'),'macos_spawn_helper_exec_contract_missing');
console.log('v10-terminal-plane-routing=PASS');
console.log('v10-terminal-helper-policy=PASS');
console.log('v10-terminal-package-contract=PASS');
