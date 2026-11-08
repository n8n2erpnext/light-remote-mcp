import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {validateCanonicalEndpoints,canonicalRoute} from '../../lib/canonical-endpoints.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const src=n=>fs.readFileSync(path.join(root,n),'utf8');
const config=JSON.parse(src('config/endpoints.json'));
const changed=structuredClone(config);
changed.profiles['goldabv2-lab'].localServices.wall.port=5499;
changed.profiles['goldabv2-lab'].localServices.fleet.port=5500;
const profile=validateCanonicalEndpoints(changed);
assert.equal(canonicalRoute(profile,'wallStatus'),'http://127.0.0.1:5499/api/status');
assert.equal(canonicalRoute(profile,'wallLogsPage'),'http://127.0.0.1:5499/settings#activityLogSettings');
// Embedded resources are copied from ONE repo file, not handwritten siblings.
const shared=src('client/windows-native/Shared/CanonicalEndpoints.cs');
for(const proj of [
 'GptOperator.Client/GptOperator.Client.csproj',
 'LightRemote.Updater/LightRemote.Updater.csproj',
 'LightRemote.InstallWatchdog/LightRemote.InstallWatchdog.csproj'
]){
 const xml=src('client/windows-native/'+proj);
 assert.match(xml,/Compile Include=".*Shared.*CanonicalEndpoints\.cs"/);
 assert.match(xml,/EmbeddedResource Include=".*config.*endpoints\.json" LogicalName="LightRemote\.Canonical\.Endpoints\.json"/);
}
assert.match(shared,/GetManifestResourceStream\(/);
assert.match(shared,/GoldLoader = new\(LoadEmbedded/);
assert.match(shared,/endpoint_untrusted_origin_/);
assert.match(shared,/update_wrong_product_or_profile/);
assert.match(shared,/UpdateManifestUrl != null \|\| UpdateSignatureUrl != null/);
const connection=src('client/windows-native/GptOperator.Client/ConnectionConfig.cs');
assert.match(connection,/CanonicalEndpoints\.Gold\.CloudOrigin\("deviceChannel"\)/);
assert.match(connection,/#else[\s\S]+https:\/\/gold\.light-remote\.thaiduy\.digital/);
const tray=src('client/windows-native/GptOperator.Client/TrayApplicationContext.cs');
const host=src('client/windows-native/GptOperator.Client/AgentHost.cs');
assert.match(tray,/CanonicalEndpoints\.Gold\.Route\("wallHome"\)/);
assert.match(tray,/CanonicalEndpoints\.Gold\.LocalBase\("fleet"\)/);
assert.match(tray,/WallPort => CanonicalEndpoints\.Gold\.LocalPort\("wall"\)/);
assert.match(tray,/OPERATOR_AGENT_WALL_PORT.*CanonicalEndpoints\.Gold\.LocalPort\("wall"\)/);
assert.match(host,/OPERATOR_AGENT_WALL_PORT.*CanonicalEndpoints\.Gold\.LocalPort\("wall"\)/);
const updater=src('client/windows-native/LightRemote.Updater/UpdateClient.cs');
const updaterProgram=src('client/windows-native/LightRemote.Updater/Program.cs');
const recovery=src('client/windows-native/LightRemote.Updater/RecoveryPaths.cs');
assert.match(updater,/CanonicalEndpoints\.Gold\.UpdateManifestUrl \?\? throw new UpdateChannelHeldException/);
assert.match(updater,/RequireSignedUpdateIdentity\(root\)/);
assert.match(updaterProgram,/LRU_PRODUCT_FEED_HOLD/);
assert.match(updaterProgram,/wrongProductRejected/);
assert.ok(updaterProgram.includes('using System.Text.Json;'),
 'Updater executable uses JsonDocument and must import System.Text.Json');
assert.match(recovery,/"Updater", "GoldABV2"/);
assert.match(src('client/windows-native/LightRemote.Updater/UpdateApplier.cs'),
 /CanonicalEndpoints\.Gold\.LocalPort\("wall"\)/);
assert.match(src('client/windows-native/LightRemote.InstallWatchdog/Program.cs'),
 /CanonicalEndpoints\.Gold\.Route\("wallHome"\)/);
const rust=src('client/desktop-v4/src-tauri/src/endpoint_config.rs');
const main=src('client/desktop-v4/src-tauri/src/main.rs');
const login=src('client/desktop-v4/src-tauri/src/owner_login.rs');
const vault=src('client/desktop-v4/src-tauri/src/owner_vault.rs');
assert.match(rust,/include_str!\("\.\.\/\.\.\/\.\.\/\.\.\/config\/endpoints\.json"\)/);
assert.match(rust,/fn credential_authority\(/);
assert.match(main,/endpoint_config::route\("wallHome"\)/);
assert.match(main,/endpoint_config::local_socket\("wall"\)/);
assert.match(login,/endpoint_config::route\("ownerToken"\)/);
assert.match(login,/endpoint_config::cloud_origin\("owner"\)/);
assert.doesNotMatch(login,/const AUTH_ORIGIN: &str = "https:/);
assert.match(vault,/Sha256::digest\(authority.as_bytes\(\)\)/);
assert.ok(vault.startsWith('//! Desktop V4 private'),
 'Rust module inner docs must precede imports to pass macOS/Linux E0753');
assert.ok(vault.replaceAll(String.fromCharCode(13,10),String.fromCharCode(10)).includes('use keyring::{Entry, Error};'+String.fromCharCode(10)+
  'use sha2::{Sha256,Digest};'),'Rust imports must be after module docs on CRLF and LF checkout');
assert.match(vault,/Entry::new\(SERVICE, &authority_account\(\)\?\)/);
const ci=src('.github/workflows/windows-native-client.yml');
assert.match(ci,/dotnet publish client\/windows-native\/LightRemote\.Updater\/LightRemote\.Updater\.csproj[\s\S]*?-o \$updaterStage @trayDefines/);
assert.match(ci,/dotnet publish client\/windows-native\/LightRemote\.InstallWatchdog\/LightRemote\.InstallWatchdog\.csproj[\s\S]*?-o \$watchdogStage @trayDefines/);
assert.match(ci,/goldabv2-native-updater-wrong-product-reject-hold-PASS/);
const installer=src('client/windows-native/installer/GptOperator.iss');
const task=src('device-agent/install-windows-task.ps1');
assert.ok(installer.includes('GoldABV2')&&installer.includes('rollback'),'Golden updater rollback dir must be isolated');
assert.ok(installer.includes('GoldABV2')&&installer.includes('state'),'Gold updater state dir must be isolated');
assert.ok(installer.includes('[UninstallDelete]')&&installer.includes('Updater\\GoldABV2'),'Gold uninstall must target own updater folder');
assert.match(task,/goldabv2-package-profile\.json/);
assert.match(task,/UpdaterRoot=Join-Path \$UpdaterRoot 'GoldABV2'/);
assert.match(ci,/WINDOWS_TEST_UPDATER_ROOT=\$qaUpdaterRoot/);
console.log('T11_NODE_DOTNET_RUST_UPDATER_WATCHDOG_ONE_JSON_BUILD_BINDING_CONTRACT_PASS');
