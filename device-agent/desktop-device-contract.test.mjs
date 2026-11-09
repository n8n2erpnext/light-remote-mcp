import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('registered native Owner commands are reachable through the explicit main-window ACL',()=>{
 const main=source('client/desktop-v4/src-tauri/src/main.rs');
 const permissions=source('client/desktop-v4/src-tauri/permissions/desktop-owner.toml');
 const commands=[...main.matchAll(/owner_login::(desktop_owner_[a-z0-9_]+)/g)].map(x=>x[1]);
 for(const command of new Set(commands))assert.ok(permissions.includes('"'+command+'"'),command+' missing from native ACL');
 assert.ok(commands.includes('desktop_owner_inventory_page'));
 assert.ok(commands.includes('desktop_owner_device_request'));
 assert.equal(permissions.includes('"*"'),false);
});
test('published native operation contract matches the compiled native action allowlist',()=>{
 const contract=JSON.parse(source('contracts/api.v1.json')).nativeTransports.desktopDevice;
 const native=source('client/desktop-v4/src-tauri/src/owner_device.rs');
 const list=native.slice(native.indexOf('const ACTIONS'),native.indexOf('fn deny'));
 const actions=[...list.matchAll(/"([a-z][a-z.-]+)"/g)].map(x=>x[1]);
 assert.deepEqual(contract.operations,actions);
 assert.ok(!actions.some(x=>/shell|exec|filesystem/.test(x)));
});
