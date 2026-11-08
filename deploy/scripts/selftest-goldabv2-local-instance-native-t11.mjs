import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const config=JSON.parse(read('config/endpoints.json'));
assert.equal(config.schemaVersion,1);
assert.equal(config.configRevision,2);
assert.deepEqual(config.routeCatalog.wallInstanceProof,{
 originRole:'local.wall',method:'GET',path:'/api/local-instance/proof'
});
const staged=JSON.parse(read('client/core-files.json'));
assert.ok(staged.files.some(f=>f.source==='device-agent/local-wall-instance-proof.mjs'&&
 f.destination==='device-agent/local-wall-instance-proof.mjs'),
 'bundled Windows Agent must stage the new Local Wall proof implementation');
const key=read('device-agent/local-wall-instance-proof.mjs');
const agent=read('device-agent/operator-agent.mjs');
const wall=read('device-agent/local-wall.mjs');
const cpp=read('client/windows-native/Shared/LocalWallChallengeProof.cs');
const listener=read('client/windows-native/Shared/WallListenerOwnership.cs');
const program=read('client/windows-native/GptOperator.Client/Program.cs');
const rust=read('client/desktop-v4/src-tauri/src/wall_instance_proof.rs');
const rustMain=read('client/desktop-v4/src-tauri/src/main.rs');
const routes=read('client/desktop-v4/src-tauri/src/endpoint_config.rs');
const workflow=read('.github/workflows/windows-native-client.yml');
assert.match(key,/openSync\(file,'wx',0o600\)/);
assert.match(key,/goldabv2_local_instance_key_invalid/);
assert.match(key,/wallInstanceMessage/);
assert.match(key,/createHmac\('sha256',key\)/);
assert.match(agent,/function goldAbV2LocalWallInstanceProof\(\)/);
assert.match(agent,/goldAbV2LocalWallInstanceProof\(\),modules:GOLD_WALL_MODULES/);
assert.match(agent,/keyFile:path\.join\(path\.dirname\(STATE_FILE\),'wall-instance\.key'\)/);
assert.match(wall,/req\.socket\.remoteAddress/);
assert.match(wall,/instanceProof\.respond\(/);
assert.match(wall,/req\.headers\.host/);
assert.ok(wall.indexOf('if(instanceProof&&url.pathname===instanceProof.routePath)')<
 wall.indexOf('if(desktopSsoSession)await desktopSsoSession.identity(req)'));
assert.match(wall,/if\(auth\?\.enabled&&!auth\.identity\(req\)\)/);
for(const proj of ['GptOperator.Client/GptOperator.Client.csproj',
 'LightRemote.Updater/LightRemote.Updater.csproj',
 'LightRemote.InstallWatchdog/LightRemote.InstallWatchdog.csproj']){
 assert.match(read('client/windows-native/'+proj),/Shared\\LocalWallChallengeProof\.cs/);
}
assert.match(listener,/LocalWallChallengeProof\.Probe\(port,pid\)/);
assert.match(cpp,/GetAsync\(url\+"\?nonce="\+nonce/);
assert.match(cpp,/CryptographicOperations\.FixedTimeEquals/);
assert.match(cpp,/UseCookies=false,UseProxy=false/);
assert.match(cpp,/readTimeout.Token/);
assert.match(cpp,/\.TryGetProperty\("configRevision"/);
assert.match(program,/cryptoVectorOk/);
assert.match(program,/nonceTamperRejected/);
assert.match(program,/pidTamperRejected/);
assert.match(program,/productTamperRejected/);
assert.match(rust,/OsRng\.fill_bytes/);
assert.match(rust,/crate::endpoint_config::route\("wallInstanceProof"\)/);
assert.match(rust,/fn mac\(/);
assert.match(rust,/diff\|=supplied\[i\]\^expected\[i\]/);
assert.match(rustMain,/wall_instance_proof::verify\(\)/);
assert.match(routes,/"wallInstanceProof"/);
assert.match(rust,/f747cc842827747022d75f5a889c7a34e55db1deefd08e5a98b0757abe510329/);
assert.match(workflow,/cryptoVectorOk/);
assert.match(workflow,/selftest-goldabv2-local-instance-proof-t11\.mjs/);
console.log('T11_F08B_HMAC_LOCAL_WALL_NODE_NET_RUST_NATIVE_PROOF_CONTRACT=PASS');
