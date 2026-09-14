import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const linux=read('device-agent/install-linux-service.sh');
const windows=read('device-agent/install-windows-service.ps1');
const agent=read('device-agent/operator-agent.mjs');

const agentModules=['operator-agent.mjs','local-wall.mjs','local-wall-auth.mjs','fleet-component-manager.mjs','fleet-component-supervisor.mjs'];
const libModules=['device-proof.mjs','native-fs.mjs','native-process.mjs','native-search.mjs','light-scp-file.mjs','light-scp-registry.mjs'];
for(const file of agentModules){
  assert.ok(linux.includes(file),`linux_missing_agent_module:${file}`);
  assert.ok(windows.includes(file),`windows_missing_agent_module:${file}`);
}
for(const file of libModules){
  assert.ok(linux.includes(file),`linux_missing_lib_module:${file}`);
  assert.ok(windows.includes(file),`windows_missing_lib_module:${file}`);
}
assert.ok(linux.includes('platform-adapters/*.mjs'),'linux_missing_platform_adapters');
assert.ok(windows.includes('platform-adapters\\*.mjs'),'windows_missing_platform_adapters');
assert.ok(linux.includes('light-remote-mark.svg'),'linux_missing_brand_asset');
assert.ok(windows.includes('light-remote-mark.svg'),'windows_missing_brand_asset');
assert.ok(agent.includes("from '../lib/light-scp-registry.mjs'"),'agent_light_scp_import_missing');
console.log('v10-device-agent-packaging-runtime-deps=PASS');
