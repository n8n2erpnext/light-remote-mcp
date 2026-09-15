import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const installer=fs.readFileSync(path.join(root,'deploy/scripts/install-host.sh'),'utf8');
const unit=fs.readFileSync(path.join(root,'deploy/systemd/gpt-vps-operator.service'),'utf8');
const executor=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');

const libs=['device-proof.mjs','native-fs.mjs','native-process.mjs','native-search.mjs','light-scp-file.mjs','light-scp-registry.mjs','update-contract.mjs','runtime-version.mjs','version-compat.mjs'];
for(const lib of libs){
  if(!installer.includes(`"/opt/gpt-vps-operator/lib/$lib"`))throw new Error(`host_installer_missing_lib:${lib}`);
  if(!installer.includes(`"/opt/gpt-vps-operator/host-wall/lib/$lib"`))throw new Error(`host_wall_installer_missing_lib:${lib}`);
}
if(!installer.includes('sudo install -m 0644 "$ROOT_DIR/VERSION" /opt/gpt-vps-operator/VERSION'))throw new Error('host_installer_root_version_missing');
if(!installer.includes('/opt/gpt-vps-operator/operator-host/'))throw new Error('operator_host_layout_not_preserved');
if(!installer.includes('/opt/gpt-vps-operator/device-agent/platform-adapters/'))throw new Error('operator_platform_adapter_layout_missing');
if(!unit.includes('WorkingDirectory=/opt/gpt-vps-operator/operator-host'))throw new Error('operator_workdir_layout_stale');
if(!unit.includes('ExecStart=/usr/bin/node /opt/gpt-vps-operator/operator-host/executor.mjs'))throw new Error('operator_exec_layout_stale');
const executorLibImports=[...executor.matchAll(/from '\.\.\/lib\/([^']+\.mjs)'/g)].map(match=>match[1]);
for(const lib of executorLibImports){
  if(!installer.includes(`\"/opt/gpt-vps-operator/lib/$lib\"`))throw new Error(`host_installer_missing_executor_import:${lib}`);
}
for(const rel of ['../lib/native-fs.mjs','../lib/native-process.mjs','../lib/native-search.mjs','../lib/light-scp-registry.mjs','../lib/runtime-version.mjs','../lib/version-compat.mjs','../device-agent/platform-adapters/index.mjs']){
  if(!executor.includes(`from '${rel}'`))throw new Error(`executor_import_contract_missing:${rel}`);
}
console.log('host-install-layout-imports=PASS');
console.log('host-install-layout-native-runtime=PASS');
console.log('host-wall-install-layout-native-runtime=PASS');
