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
assert.match(rust,/"home" => Ok\("http:\/\/127\.0\.0\.1:5491\/"\)/);
assert.match(rust,/"logs" => Ok\("http:\/\/127\.0\.0\.1:5491\/settings#activityLogSettings"\)/);
assert.match(rust,/SocketAddrV4::new\(Ipv4Addr::LOCALHOST, 5491\)/);
assert.match(rust,/Host: 127\.0\.0\.1:5491/);
assert.doesNotMatch(rust,/100\.94\.184\.141|15591|LR_V4_WALL_PROFILE|use_goldabv2_lab_wall/);
assert.doesNotMatch(workflow,/LR_V4_WALL_PROFILE|100\.94\.184\.141|15591/);
assert.match(owner,/const AUTH_ORIGIN: &str = "https:\/\/goldabv2\.light-remote\.thaiduy\.digital"/);
assert.doesNotMatch(owner,/use_goldabv2_lab_wall|100\.94\.184\.141|15591/);
assert.match(workflow,/VITE_LR_V4_WALL_SSO_CANDIDATE: '0'/);
console.log('desktop-local-wall-route-contract PASS: same-device localhost, GoldABV2 Owner HTTPS distinct, LXD NAT absent');
