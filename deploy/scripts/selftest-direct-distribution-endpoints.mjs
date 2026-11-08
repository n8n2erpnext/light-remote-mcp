import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const stable='https://light-remote.thaiduy.digital';

const windowsConfig=read('client/windows-native/GptOperator.Client/ConnectionConfig.cs');
const windowsTray=read('client/windows-native/GptOperator.Client/TrayApplicationContext.cs');
const macLaunchd=read('client/macos/launchd/com.lightremote.agent.plist');
const macTray=read('client/macos/tray/main.swift');
const linuxDesktop=read('client/linux-debian/systemd/light-remote-agent.service');
const linuxServer=read('client/linux/install.sh');
const hostWall=read('deploy/systemd/light-remote-host-wall.service');
const runtimeRoutes=read('operator-host/executor-routes-runtime.mjs');
const directBuild=read('deploy/direct-linux/build-bundle.sh');

assert.ok(windowsConfig.includes(`StablePublicEndpoint = "${stable}"`),'windows stable endpoint');
assert.ok(windowsTray.includes(`AccountUrl = "${stable}/account"`),'windows account endpoint');
assert.ok(windowsTray.includes('LocalFleetUrl = "http://127.0.0.1:5492/"')&&!windowsTray.includes('FleetPortalUrl'),'windows fleet local endpoint only');
assert.ok(macLaunchd.includes(`<string>${stable}</string>`),'macos launchd endpoint');
assert.ok(macTray.includes(`let accountPortal = "${stable}/account"`),'macos tray endpoint');
assert.ok(linuxDesktop.includes(`OPERATOR_AGENT_BASE_URL=${stable}`)&&linuxDesktop.includes(`OPERATOR_AGENT_HUB_URL=${stable}`),'linux desktop endpoint');
assert.ok(linuxServer.includes(`BASE_URL="\${OPERATOR_AGENT_BASE_URL:-${stable}}"`)&&linuxServer.includes(`HUB_URL="\${OPERATOR_AGENT_HUB_URL:-${stable}}"`),'linux server endpoint');
assert.ok(hostWall.includes(`OPERATOR_AGENT_HUB_URL=${stable}`),'linux server host-wall endpoint');

for(const [name,text] of Object.entries({windowsTray,macLaunchd,macTray,linuxDesktop,hostWall})){
  assert.ok(!text.includes('https://light-remote-mcp.vercel.app'),name+' vercel default leaked');
  assert.ok(!text.includes('https://mcp.dashboard.thaiduy.store'),name+' legacy mcp default leaked');
  assert.ok(!text.includes('https://lightremote.thaiduy.digital'),name+' legacy no-dash endpoint leaked');
}

assert.ok(directBuild.includes('cp -a "$ROOT_DIR/assets" "$PKG/assets"'),'direct bundle web assets missing');
assert.ok(runtimeRoutes.includes("url.pathname === '/v1/terminal'"),'official terminal route missing');
assert.ok(runtimeRoutes.includes("startTerminalOperation(payload,requestId)"),'official terminal operation dispatch missing');

console.log('distribution_windows_direct_endpoint=PASS');
console.log('distribution_macos_direct_endpoint=PASS');
console.log('distribution_linux_desktop_direct_endpoint=PASS');
console.log('distribution_linux_server_direct_endpoint=PASS');
console.log('official_terminal_facade_route=PASS');
