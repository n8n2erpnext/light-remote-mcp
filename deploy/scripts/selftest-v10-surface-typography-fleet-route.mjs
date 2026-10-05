import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WEB_UI_FONT, WALL_UI_FONT, WALL_CODE_FONT } from '../../lib/web-typography.mjs';
import { dashboardHtml } from '../../gateway/dashboard.mjs';
import { devicePolicyHtml } from '../../gateway/device-policy-page.mjs';
import { updateSettingsHtml } from '../../device-agent/update-settings-page.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const read=rel=>fs.readFileSync(new URL('../../'+rel,import.meta.url),'utf8');
const wall=(html,label)=>{
  assert.ok(html.includes("font-family:'Cascadia Mono'"),label+' missing Cascadia Mono');
  assert.ok(html.includes("font-family:'Cascadia Code'"),label+' missing Cascadia Code');
  assert.ok(!html.includes("font-family:'Google Sans'"),label+' leaked Google Sans');
};
const web=(html,label)=>{
  assert.ok(html.includes("font-family:'Google Sans'"),label+' missing Google Sans');
  assert.ok(!html.includes("font-family:'Cascadia Mono'"),label+' leaked Wall font');
};

assert.match(WEB_UI_FONT,/Google Sans/);
assert.match(WALL_UI_FONT,/Cascadia Mono/);
assert.match(WALL_CODE_FONT,/Cascadia Code/);

wall(dashboardHtml({surface:'fleet'}),'fleet dashboard');
wall(devicePolicyHtml('dev_test',{surface:'fleet'}),'fleet policy');
wall(updateSettingsHtml({surface:'local'}),'local update');
wall(updateSettingsHtml({surface:'fleet'}),'fleet update');
web(dashboardHtml(),'hosted dashboard');
web(devicePolicyHtml('dev_test'),'hosted policy');

const agent=read('device-agent/operator-agent.mjs');
const tray=read('client/windows-native/GptOperator.Client/TrayApplicationContext.cs');
const fleetBuild=read('deploy/scripts/build-fleet-wall-module.sh');
const fleetRelease=read('.github/workflows/fleet-wall-component-release.yml');
assert.ok(agent.includes('fleetWall:await localFleetStatus()'),'agent status must expose Fleet Wall health');
assert.ok(tray.includes('LocalFleetUrl = "http://127.0.0.1:5492/"'),'tray must target local Fleet Wall');
assert.ok(!tray.includes('FleetPortalUrl'),'tray must not fall back Open Fleet to account portal');
assert.ok(tray.includes('status.FleetHealthy ?')&&tray.includes(': null;'),'tray must hide Open Fleet when Fleet is unhealthy');
assert.ok(fleetBuild.includes('LIGHT_REMOTE_FLEET_VERSION:-'),'Fleet build must support isolated component versioning');
assert.ok(fleetRelease.includes("fleet-wall-v0.9.0-rc.*")&&fleetRelease.includes('LIGHT_REMOTE_FLEET_VERSION="$FLEET_VERSION"'),'Fleet release workflow must remain isolated from Core VERSION');

console.log('surface-typography-web-google-sans=PASS');
console.log('surface-typography-wall-cascadia=PASS');
console.log('tray-open-fleet-local-only=PASS');
