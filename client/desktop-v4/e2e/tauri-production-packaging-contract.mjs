// Source/CI packaging contract, NOT a substitute for physical Windows E2E.
// Raw cargo --release does not run the Tauri CLI asset embedding pipeline.
// The old Owner LAB binary consequently opened 127.0.0.1:5174 in WebView2.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const project=path.resolve(dir,'..');
const repository=path.resolve(project,'../..');
const workflow=fs.readFileSync(
  path.join(repository,'.github/workflows/desktop-v4-native-ci.yml'),'utf8');
const config=JSON.parse(fs.readFileSync(
  path.join(project,'src-tauri/tauri.conf.json'),'utf8'));
const pack=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
const start=workflow.indexOf('\n  owner-login-lab-candidate:');
assert.ok(start>0,'dedicated Owner LAB CI job must exist');
const ownerJob=workflow.slice(start);
assert.match(ownerJob,/VITE_LR_V4_OWNER_LOGIN:\s*'1'/);
assert.match(ownerJob,/VITE_LR_V4_UI_TEST:\s*'0'/);
assert.match(ownerJob,/LR_V4_WALL_PROFILE:\s*'goldabv2-lab'/);
assert.match(ownerJob,/run: npm exec -- tauri build --no-bundle --features desktop-owner-login --ci/);
assert.doesNotMatch(ownerJob,/^\s*run:\s*cargo build\s/m,
  'raw cargo cannot create a standalone Tauri frontend');
assert.equal(pack.devDependencies['@tauri-apps/cli'],'2.12.4');
assert.equal(config.build.frontendDist,'../dist');
assert.match(config.build.devUrl,/^http:\/\/127\.0\.0\.1:/);
assert.equal(config.bundle.active,false,'QA must not silently publish a signed installer');
const frontend=path.resolve(project,'src-tauri',config.build.frontendDist);
const index=path.join(frontend,'index.html');
assert.ok(fs.statSync(index).isFile(),'production dist/index.html must be built first');
const assetDir=path.join(frontend,'assets');
const assets=fs.readdirSync(assetDir);
assert.ok(assets.some(file=>file.endsWith('.js')),
  'production dist must include compiled JS assets');
assert.ok(assets.some(file=>file.endsWith('.css')),
  'production dist must include compiled CSS assets');
const html=fs.readFileSync(index,'utf8');
assert.ok(!html.includes('127.0.0.1:5174'),
  'production frontend HTML must not load the Vite dev server');
assert.ok(html.includes('assets/'),
  'production index must reference bundled frontend assets');
console.log('TAURI_V4_OWNER_PRODUCTION_PACKAGING_SOURCE_CONTRACT_PASS');
