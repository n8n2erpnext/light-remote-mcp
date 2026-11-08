import fs from 'node:fs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const main=read('client/desktop-v4/src-tauri/src/main.rs');
const manifest=read('client/desktop-v4/src-tauri/build.rs');
const native=read('client/desktop-v4/src-tauri/src/owner_login.rs');
const web=read('client/desktop-v4/src/lib/native-inventory.ts');
const portal=read('plugin-server/desktop-owner-token-v4.mjs');
const backend=read('operator-host/executor-routes-account.mjs');
assert.equal(main.split('owner_login::desktop_owner_inventory_page').length-1,2,
  'new read command must be registered for both Windows and mac/Linux candidates');
assert.match(manifest,/"desktop_owner_inventory_page"/,
  'explicit Tauri Owner candidate command permission required');
assert.match(native,/pub\(crate\) async fn desktop_owner_inventory_page/);
assert.match(native,/wall_snapshot_after_verification\(\)\.await/);
assert.match(native,/wall_snapshot_current_after_verification\(&snap\)\.await/);
assert.match(native,/\.post\(snapshot_url\(\)\)\.bearer_auth\(&access\)/,
  'same canonical Owner HTTPS endpoint and native bearer only');
assert.match(native,/"page":\{"kind":requested_kind,"cursor":cursor,"limit":100\}/,
  'native only sends kind/cursor/limit, no foreign Account selector');
assert.match(portal,/function inventoryPageInput/);
assert.match(portal,/nativeOnly\(req,res\)/);
assert.match(backend,/createDesktopV4OwnerInventoryPage/);
assert.match(web,/desktop_owner_inventory_page/);
assert.doesNotMatch(web,/\bfetch\s*\(|\bXMLHttpRequest\b|\.cookie\b/);
console.log('T11_F14_NATIVE_OWNER_ONLY_PAGE_IPC_ENDPOINT_BINDING=PASS');
