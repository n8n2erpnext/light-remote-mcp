import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// GoldABV2 Desktop must never reuse Gold production device identity/profile,
// and the bundled Agent must reject inherited production endpoints, even
// when it is launched without the .NET Tray.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const agent=path.join(root,'device-agent/operator-agent.mjs');
const marker=path.join(root,'device-agent/goldabv2-package-profile.json');
const appPaths=fs.readFileSync(path.join(root,'client/windows-native/GptOperator.Client/AppPaths.cs'),'utf8');
const connection=fs.readFileSync(path.join(root,'client/windows-native/GptOperator.Client/ConnectionConfig.cs'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/windows-native-client.yml'),'utf8');
assert.match(appPaths,/#if LIGHT_REMOTE_GOLDABV2_V4[\s\S]*?LightRemoteGoldABV2/);
assert.match(appPaths,/gpt-operator-agent-goldabv2/);
assert.match(connection,/#if LIGHT_REMOTE_GOLDABV2_V4[\s\S]*?return new ConnectionSettings\(DefaultBridgeUrl, DefaultHubUrl\);/);
assert.match(connection,/goldabv2_wrong_server_endpoint/);
assert.match(workflow,/goldabv2-package-profile\.json/);
assert.match(workflow,/goldabv2_build_wrong_server_endpoint/);
assert.ok(!fs.existsSync(marker),'The developer source tree must not permanently carry an install-only profile marker');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'goldabv2-profile-test-'));
try{
  fs.writeFileSync(marker,JSON.stringify({profile:'goldabv2-desktop-v4',
    endpoint:'https://goldabv2.light-remote.thaiduy.digital'})+'\n');
  const common={...process.env,OPERATOR_AGENT_STATE:path.join(tmp,'nonexistent.json'),
    OPERATOR_AGENT_IDENTITY_FILE:''};
  const bad=spawnSync(process.execPath,[agent,'status'],{
    cwd:root,env:{...common,OPERATOR_AGENT_BASE_URL:'https://gold.light-remote.thaiduy.digital',
      OPERATOR_AGENT_HUB_URL:'https://goldabv2.light-remote.thaiduy.digital'},
    encoding:'utf8',timeout:20000});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/goldabv2_build_wrong_server_endpoint/);
  const good=spawnSync(process.execPath,[agent,'status'],{
    cwd:root,env:{...common,OPERATOR_AGENT_BASE_URL:'https://goldabv2.light-remote.thaiduy.digital',
      OPERATOR_AGENT_HUB_URL:'https://goldabv2.light-remote.thaiduy.digital'},
    encoding:'utf8',timeout:20000});
  assert.equal(good.status,0,'Valid GoldABV2 origin must allow local status inspection');
  assert.doesNotMatch(good.stderr,/goldabv2_build_wrong_server_endpoint/);
  assert.match(good.stdout,/"enrolled": false/);
}finally{
  fs.rmSync(marker,{force:true});
  fs.rmSync(tmp,{recursive:true,force:true});
}
console.log('GOLDABV2_DESKTOP_SINGLE_TARGET_AND_ISOLATED_PROFILE_PASS');
