// T07: one installer from the actual Windows Agent/Wall/RM packaging pipeline.
// Desktop UI-only validation is no longer a user-facing installer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(here,'..');
const repository=path.resolve(project,'../..');
const sourceCI=fs.readFileSync(path.join(repository,'.github/workflows/desktop-v4-native-ci.yml'),'utf8');
const installerCI=fs.readFileSync(path.join(repository,'.github/workflows/windows-native-client.yml'),'utf8');
const inno=fs.readFileSync(path.join(repository,'client/windows-native/installer/GptOperator.iss'),'utf8');
const config=JSON.parse(fs.readFileSync(path.join(project,'src-tauri/tauri.conf.json'),'utf8'));
const manifest=fs.readFileSync(path.join(project,'src-tauri/Cargo.toml'),'utf8');
const pack=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
assert.doesNotMatch(sourceCI,/--bundles nsis|light-remote-desktop-v4-UNIFIED-NSIS-LAB/,
  'Never upload a separate UI/Owner-only Desktop installer');
assert.doesNotMatch(sourceCI,/\n  native-shell:|\n  owner-login-lab-candidate:/,
  'Old UI-only and Owner-only build variants must not exist');
assert.match(sourceCI,/tauri build --no-bundle --features desktop-owner-login --ci/);
const gate='feat/desktop-v4-api-integration-20261103';
assert.ok(installerCI.includes(gate),'Full Windows installer CI must trigger for the unified V4 source branch');
for(const expected of [
  /Build and stage Desktop V4 in the SAME full Agent\/Wall\/RM installation/,
  /tauri build --no-bundle --features desktop-owner-login --ci/,
  /dist\/windows\/stage\/desktop-v4/,
  /device-agent\/desktop-abv2-native-ipc-v4\.mjs/,
  /realremote-v2\/LightRemote\.RM\.exe/,
  /\/DUnifiedDesktopV4=1/,
  /Upload ONE complete Windows Desktop V4 \+ Agent \+ Wall \+ RM installer/,
  /VITE_LR_V4_OWNER_LOGIN:\s*'1'/,
  /VITE_LR_V4_ABV2_NATIVE:\s*'1'/,
  /VITE_LR_V4_OWNER_SNAPSHOT:\s*'1'/,
  /VITE_LR_V4_WALL_SSO_CANDIDATE:\s*'0'/,
])assert.match(installerCI,expected);
for(const expected of [
  /#ifdef UnifiedDesktopV4/,
  /desktop-v4\\LightRemote\.Desktop\.exe/,
  /GptOperator\.Client\.exe/,
  /LightRemoteDeviceAgent/,
])assert.match(inno,expected);
assert.ok(fs.existsSync(path.join(repository,'device-agent/desktop-abv2-native-ipc-v4.mjs')),
  'The bundled Agent source must contain same-host native A/B V2 IPC');
assert.ok(fs.existsSync(path.join(repository,'operator-host/desktop-v4-owner-snapshot.mjs')),
  'The integrated source must have GoldABV2 Owner snapshot backend');
assert.match(manifest,/default = \["desktop-owner-login"\]/);
assert.equal(pack.devDependencies['@tauri-apps/cli'],'2.12.4');
assert.equal(config.build.frontendDist,'../dist');
assert.match(config.build.devUrl,/^http:\/\/127\.0\.0\.1:/);
assert.equal(config.bundle.active,true);
assert.ok(config.app.security.capabilities.some(c=>
  c.windows.includes('main')&&c.permissions.includes('allow-desktop-owner')));
const index=path.join(project,'dist/index.html');
assert.ok(fs.statSync(index).isFile(),'Production React UI must be compiled into Tauri');
const assets=fs.readdirSync(path.join(project,'dist/assets'));
assert.ok(assets.some(f=>f.endsWith('.js'))&&assets.some(f=>f.endsWith('.css')));
const html=fs.readFileSync(index,'utf8');
assert.ok(!html.includes('127.0.0.1:5174'),'Installer must not depend on Vite dev server');
console.log('T07_COMPLETE_DESKTOP_AGENT_WALL_RM_INSTALLER_SOURCE_CONTRACT_PASS');
