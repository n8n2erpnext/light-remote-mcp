/**
 * T04 topology regression: Desktop always opens the Wall on its own host.
 * Never mistake a Linux LXD NetBird QA NAT endpoint for the Windows/macOS/
 * Linux Desktop device-local Wall. GoldABV2 Account HTTPS is independent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const rust=fs.readFileSync(path.join(root,'src-tauri/src/main.rs'),'utf8');
const owner=fs.readFileSync(path.join(root,'src-tauri/src/owner_login.rs'),'utf8');
const workflow=fs.readFileSync(path.join(root,'../../.github/workflows/desktop-v4-native-ci.yml'),'utf8');

assert.match(rust,/fn exact_wall_view\(view: &str\)/);
assert.match(rust,/endpoint_config::route\("wallHome"\)/);
assert.match(rust,/endpoint_config::route\("wallLogsPage"\)/);
assert.match(rust,/endpoint_config::local_socket\("wall"\)/);
assert.match(rust,/endpoint_config::route\("wallStatus"\)/);
assert.doesNotMatch(rust,/100\.94\.184\.141|15591|LR_V4_WALL_PROFILE|use_goldabv2_lab_wall/);
assert.doesNotMatch(workflow,/LR_V4_WALL_PROFILE|100\.94\.184\.141|15591/);
assert.match(owner,/crate::endpoint_config::cloud_origin\("owner"\)/);
assert.match(owner,/crate::endpoint_config::route\("ownerAuthorize"\)/);
const canonical=JSON.parse(fs.readFileSync(path.join(root,'../../config/endpoints.json'),'utf8'));
assert.equal(canonical.selectedProfile,'goldabv2-lab');
assert.equal(canonical.profiles['goldabv2-lab'].localServices.wall.host,'127.0.0.1');
assert.doesNotMatch(owner,/use_goldabv2_lab_wall|100\.94\.184\.141|15591/);
assert.match(workflow,/VITE_LR_V4_WALL_SSO_CANDIDATE: '0'/);
console.log('desktop-local-wall-route-contract PASS: same-device localhost, GoldABV2 Owner HTTPS distinct, LXD NAT absent');
