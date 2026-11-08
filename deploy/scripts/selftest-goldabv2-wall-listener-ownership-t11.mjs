import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const file=s=>fs.readFileSync(new URL('../../'+s,import.meta.url),'utf8');
const ownership=file('client/windows-native/Shared/WallListenerOwnership.cs');
const tray=file('client/windows-native/GptOperator.Client/TrayApplicationContext.cs');
const updater=file('client/windows-native/LightRemote.Updater/UpdateApplier.cs');
const watchdog=file('client/windows-native/LightRemote.InstallWatchdog/Program.cs');
const program=file('client/windows-native/GptOperator.Client/Program.cs');
const workflow=file('.github/workflows/windows-native-client.yml');
assert.match(ownership,/GetExtendedTcpTable/);
assert.match(ownership,/OwnerPidListenerTable=3/);
assert.match(ownership,/rawAddress!=0x0100007F/);
assert.match(ownership,/GetProcessById\(pid\)/);
assert.match(ownership,/process\.MainModule\?\.FileName/);
assert.match(ownership,/goldabv2-package-profile\.json/);
assert.match(ownership,/root\.TryGetProperty\("productId"/);
assert.match(ownership,/root\.TryGetProperty\("configProfile"/);
assert.match(ownership,/IsExactInstalledRuntimePath\(process\.MainModule\?\.FileName,installDir\)/);
for(const proj of ['GptOperator.Client/GptOperator.Client.csproj',
 'LightRemote.Updater/LightRemote.Updater.csproj','LightRemote.InstallWatchdog/LightRemote.InstallWatchdog.csproj']){
 const xml=file('client/windows-native/'+proj);
 assert.ok(xml.includes('WallListenerOwnership.cs'),'missing same shared native listener identity '+proj);
}
assert.match(tray,/#if LIGHT_REMOTE_GOLDABV2_V4\s+return WallListenerOwnership\.IsExpectedWall\(WallPort,AppPaths\.Root\)/);
assert.match(tray,/WallListenerOwnership\.HasLoopbackListener\(WallPort\)/);
assert.match(tray,/Local Wall port is occupied by a different process/);
assert.match(tray,/var killed = false;[\s\S]*?#else[\s\S]*?var killed = KillStaleWallListener\(\)/);
assert.match(updater,/WallListenerOwnership\.IsExpectedWall\(WallPort,installDir\)/);
assert.match(updater,/WaitForWallStateAsync\(bool listening,TimeSpan timeout,string installDir\)/);
assert.match(watchdog,/WallListenerOwnership\.IsExpectedWall\(CanonicalEndpoints\.Gold\.LocalPort\("wall"\),installRoot\)/);
assert.match(watchdog,/Updater", "GoldABV2", "rollback"/);
assert.match(program,/--wall-listener-self-test-output/);
assert.match(program,/wrongProductRejected/);
assert.match(program,/new TcpListener\(IPAddress\.Loopback,0\)/);
assert.match(program,/wrongListenerRejected=!WallListenerOwnership\.IsExpectedWall\(port,temp\)/);
assert.match(workflow,/goldabv2-native-wrong-listener-pid-profile-PASS/);
// Old regular Gold remains on existing behavior, not silently changed.
assert.match(tray,/#else\s+try[\s\S]*?GetActiveTcpListeners\(\)/);
console.log('T11_GOLDABV2_PID_INSTALL_MARKER_WRONG_LISTENER_FAIL_CLOSED_SOURCE=PASS');
