import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const installer=fs.readFileSync(path.join(root,'deploy/scripts/install-host.sh'),'utf8');
const unit=fs.readFileSync(path.join(root,'deploy/systemd/gpt-vps-operator.service'),'utf8');
const executor=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');
const agent=fs.readFileSync(path.join(root,'device-agent/operator-agent.mjs'),'utf8');

const libs=['device-proof.mjs','native-fs.mjs','native-process.mjs','native-terminal.mjs','native-desktop.mjs','real-remote-policy.mjs','real-remote-input.cjs','native-search.mjs','activity-ring.mjs','light-scp-file.mjs','light-scp-registry.mjs','update-contract.mjs','runtime-version.mjs','version-compat.mjs'];
for(const lib of libs){
  const occurrences=installer.split(lib).length-1;
  if(occurrences<2)throw new Error(`host_installer_missing_lib:${lib}:${occurrences}`);
}
if(!installer.includes('stage-terminal-runtime.mjs')||!installer.includes('/opt/gpt-vps-operator linux "$TERMINAL_ARCH"'))throw new Error('host_installer_terminal_runtime_stage_missing');
if(!installer.includes('sudo install -m 0644 "$ROOT_DIR/VERSION" /opt/gpt-vps-operator/VERSION'))throw new Error('host_installer_root_version_missing');
if(!installer.includes('/opt/gpt-vps-operator/operator-host/'))throw new Error('operator_host_layout_not_preserved');
if(!installer.includes('/opt/gpt-vps-operator/device-agent/platform-adapters/'))throw new Error('operator_platform_adapter_layout_missing');
if(!unit.includes('WorkingDirectory=/opt/gpt-vps-operator/operator-host'))throw new Error('operator_workdir_layout_stale');
if(!unit.includes('ExecStart=/usr/bin/node /opt/gpt-vps-operator/operator-host/executor.mjs'))throw new Error('operator_exec_layout_stale');
const executorLibImports=[...executor.matchAll(/from '\.\.\/lib\/([^']+\.mjs)'/g)].map(match=>match[1]);
for(const lib of executorLibImports)if(!libs.includes(lib))throw new Error(`host_installer_missing_executor_import:${lib}`);
for(const rel of ['../lib/native-fs.mjs','../lib/native-process.mjs','../lib/native-terminal.mjs','../lib/native-search.mjs','../lib/activity-ring.mjs','../lib/light-scp-registry.mjs','../lib/runtime-version.mjs','../lib/version-compat.mjs','../device-agent/platform-adapters/index.mjs']){
  if(!executor.includes(`from '${rel}'`))throw new Error(`executor_import_contract_missing:${rel}`);
}
for(const rel of ['../lib/native-fs.mjs','../lib/native-process.mjs','../lib/native-terminal.mjs','../lib/native-desktop.mjs','../lib/real-remote-policy.mjs','../lib/native-search.mjs','../lib/light-scp-registry.mjs','../lib/update-contract.mjs','../lib/runtime-version.mjs']){
  if(!agent.includes(`from '${rel}'`))throw new Error(`host_wall_agent_import_contract_missing:${rel}`);
}
if(!agent.includes("from '../lib/real-remote-input.cjs'"))throw new Error('host_wall_agent_import_contract_missing:real-remote-input.cjs');
console.log('host-install-layout-imports=PASS');
console.log('host-install-layout-native-runtime=PASS');
console.log('host-wall-install-layout-native-runtime=PASS');