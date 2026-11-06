// One native Desktop V4 app per OS; Windows exposes one NSIS Setup.exe.
// Source CI evidence, not runtime acceptance or installer code signing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(dir,'..');
const repository=path.resolve(project,'../..');
const workflow=fs.readFileSync(path.join(repository,'.github/workflows/desktop-v4-native-ci.yml'),'utf8');
const config=JSON.parse(fs.readFileSync(path.join(project,'src-tauri/tauri.conf.json'),'utf8'));
const manifest=fs.readFileSync(path.join(project,'src-tauri/Cargo.toml'),'utf8');
const pack=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
const start=workflow.indexOf('\n  unified-desktop:');
assert.ok(start>0,'One unified Desktop build job must exist');
const job=workflow.slice(start);
assert.doesNotMatch(workflow,/\n  native-shell:|\n  owner-login-lab-candidate:/,
  'UI-only and Owner-only native build jobs must never coexist');
for(const expected of [
  /VITE_LR_V4_OWNER_LOGIN:\s*'1'/,
  /VITE_LR_V4_UI_TEST:\s*'0'/,
  /VITE_LR_V4_ABV2_NATIVE:\s*'1'/,
  /VITE_LR_V4_OWNER_SNAPSHOT:\s*'1'/,
  /VITE_LR_V4_WALL_SSO_CANDIDATE:\s*'0'/,
  /tauri build --features desktop-owner-login --bundles nsis --ci/,
  /target\/release\/bundle\/nsis\/\*\.exe/,
  /\$items\.Count -ne 1/,
])assert.match(job,expected);
assert.doesNotMatch(job,/^\s*run:\s*cargo build\s/m,
  'Raw Cargo does not package embedded production React UI');
assert.doesNotMatch(workflow,/LR_V4_WALL_PROFILE|100\.94\.184\.141|15591/,
  'Never route the desktop to a remote Linux LXD Wall');
assert.match(manifest,/default = \["desktop-owner-login"\]/);
assert.equal(pack.devDependencies['@tauri-apps/cli'],'2.12.4');
assert.equal(config.build.frontendDist,'../dist');
assert.match(config.build.devUrl,/^http:\/\/127\.0\.0\.1:/);
assert.equal(config.bundle.active,true);
assert.equal(config.productName,'Light Remote Desktop');
assert.ok(config.app.security.capabilities.some(c=>
  c.windows.includes('main')&&c.permissions.includes('allow-desktop-owner')));
const frontend=path.resolve(project,'src-tauri',config.build.frontendDist);
const index=path.join(frontend,'index.html');
assert.ok(fs.statSync(index).isFile(),'Built production dist/index.html required');
const assetDir=path.join(frontend,'assets'),assets=fs.readdirSync(assetDir);
assert.ok(assets.some(f=>f.endsWith('.js')));
assert.ok(assets.some(f=>f.endsWith('.css')));
const html=fs.readFileSync(index,'utf8');
assert.ok(!html.includes('127.0.0.1:5174'),'Dev server must not be required by installer');
assert.ok(html.includes('assets/'));
console.log('DESKTOP_V4_UNIFIED_NATIVE_INSTALLER_CONTRACT_PASS');
