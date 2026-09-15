import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('../..',import.meta.url).pathname);
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const fleet=read('device-agent/fleet-wall-runtime.mjs');
const dashboard=read('gateway/dashboard.mjs');
const brand=read('lib/brand.mjs');
const build=read('deploy/scripts/build-fleet-wall-module.sh');

for(const token of ["url.pathname==='/settings'","url.pathname==='/api/updates/all'","fleet-device-update"]) {
  if(!fleet.includes(token))throw new Error(`fleet_update_contract_missing:${token}`);
}
if(!fleet.includes("d.deviceId!==value.mainDeviceId&&d.state==='online'"))throw new Error('fleet_bulk_scope_not_current_online_leafs');
if(!dashboard.includes("settings.href='/settings'"))throw new Error('fleet_settings_link_missing');
if(!brand.includes("BRANDING_VERSION='0.9.0-rc.6.brand1'"))throw new Error('branding_baseline_missing');
if(fleet.includes('fallback:BRANDING_VERSION')||!fleet.includes("runtimeVersion({envNames:['LIGHT_REMOTE_FLEET_VERSION']})"))throw new Error('fleet_component_version_coupled_to_brand');
if(!build.includes('update-settings-page.mjs'))throw new Error('fleet_settings_module_not_packaged');
console.log('v10-fleet-update-all-current=PASS');
console.log('v10-branding-baseline-brand1=PASS');
