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
try{
  const generated=spawnSync(process.execPath,
    [path.join(root,'deploy/scripts/generate-endpoint-package-marker.mjs'),marker],
    {cwd:root,encoding:'utf8'});
  assert.equal(generated.status,0,generated.stderr);
  const profile=JSON.parse(fs.readFileSync(marker,'utf8'));
  assert.equal(profile.configProfile,'goldabv2-lab');
  assert.match(profile.configSha256,/^[a-f0-9]{64}$/);
  const common={...process.env,OPERATOR_AGENT_IDENTITY_FILE:''};
  delete common.OPERATOR_AGENT_STATE;
  // The CI/device host may have local port overrides for other running agents.
  // A fresh V4 bundle must not inherit unrelated local service authority.
  for(const key of ['OPERATOR_AGENT_WALL_HOST','OPERATOR_AGENT_WALL_PORT',
    'OPERATOR_FLEET_WALL_HOST','OPERATOR_FLEET_WALL_PORT'])delete common[key];
  const target='https://goldabv2.light-remote.thaiduy.digital';
  const bad=spawnSync(process.execPath,[agent,'status'],{
    cwd:root,env:{...common,OPERATOR_AGENT_BASE_URL:'https://gold.light-remote.thaiduy.digital',
      OPERATOR_AGENT_HUB_URL:target},
    encoding:'utf8',timeout:20000});
  assert.notEqual(bad.status,0);
  assert.match(bad.stderr,/goldabv2_build_wrong_server_endpoint/);
  const badState=spawnSync(process.execPath,[agent,'status'],{
    cwd:root,env:{...common,OPERATOR_AGENT_BASE_URL:target,
      OPERATOR_AGENT_HUB_URL:target,
      OPERATOR_AGENT_STATE:path.join(os.tmpdir(),'legacy-gold','device.json')},
    encoding:'utf8',timeout:20000});
  assert.notEqual(badState.status,0);
  assert.match(badState.stderr,/goldabv2_build_state_profile_mismatch/);
  const good=spawnSync(process.execPath,[agent,'status'],{
    cwd:root,env:{...common,OPERATOR_AGENT_BASE_URL:target,
      OPERATOR_AGENT_HUB_URL:target},
    encoding:'utf8',timeout:20000});
  assert.equal(good.status,0,'Valid GoldABV2 origin must allow local status inspection: '+good.stderr.slice(0,2500));
  assert.doesNotMatch(good.stderr,/goldabv2_build_wrong_server_endpoint|goldabv2_build_state_profile_mismatch/);
}finally{
  fs.rmSync(marker,{force:true});
}
console.log('GOLDABV2_DESKTOP_SINGLE_TARGET_AND_ISOLATED_PROFILE_PASS');
