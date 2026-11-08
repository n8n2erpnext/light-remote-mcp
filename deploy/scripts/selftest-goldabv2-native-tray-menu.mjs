import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const tray=fs.readFileSync(path.join(root,'client/windows-native/GptOperator.Client/TrayApplicationContext.cs'),'utf8');
const agent=fs.readFileSync(path.join(root,'device-agent/operator-agent.mjs'),'utf8');
const wall=fs.readFileSync(path.join(root,'device-agent/local-wall.mjs'),'utf8');
const operator=fs.readFileSync(path.join(root,'operator-host/executor-routes-device-channel.mjs'),'utf8');
const executor=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');

assert.match(tray,/ContextMenuStrip = menu/);
assert.doesNotMatch(tray,/new TrayPopoverForm\s*\(/);
assert.doesNotMatch(tray,/_popover\.Toggle/);
for(const title of ['Open Light Remote','Open Wall','Open Fleet','Manage Account',
 'Link / Relink','Restart','Stop','Check Update','Exit'])
 assert.ok(tray.includes('"'+title+'"'), 'Missing native menu item: '+title);
assert.match(tray,/DeviceHeader\(Environment\.MachineName, status\.ShortId\)/);
assert.match(tray,/host \+ " - Short ID : " \+ code/);
assert.match(tray,/status\.IsMain/);
assert.match(tray,/state == "ready"/);
assert.match(tray,/Check Update \(1\)/);
assert.match(tray,/desktop-v4", "LightRemote\.Desktop\.exe/);
assert.match(tray,/BridgeUrl\.TrimEnd\('\/'\) \+ "\/account"/);
assert.match(tray,/MessageBox\.Show\([\s\S]*?Disconnect this PC from Local Wall before Relink/);

assert.match(operator,/goldShortIdByDevice/);
assert.match(operator,/isMain:account\?\.mainDeviceId===ctx\.device\.deviceId/);
assert.match(executor,/lr_gold_device_short_ids/);
assert.match(executor,/d\.owner_account_id=\$2/);
assert.match(agent,/snapshot\.shortId=/);
assert.match(agent,/snapshot\.isMain=signed\.isMain===true/);
assert.match(wall,/remoteState\?\.shortId/);
assert.match(wall,/if\(short&&shortId\)short\.textContent=shortId/);
console.log('GOLDABV2_NATIVE_WINDOWS_TRAY_MENU_SIGNED_SHORT_ID_MAIN_PASS');
