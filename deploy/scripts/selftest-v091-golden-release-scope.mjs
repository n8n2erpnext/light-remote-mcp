import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const need=(value,message)=>{if(!value)throw new Error(message);};
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const exists=rel=>fs.existsSync(path.join(root,rel));

const version=read('VERSION').trim();
need(/^0\.9\.0-rc\.\d+$/.test(version),'wrong_release_version');
need(JSON.parse(read('package.json')).version===version,'root_package_version_drift');
for(const forbiddenPath of ['netlify','netlify.toml'])need(!exists(forbiddenPath),'active_netlify_path_present:'+forbiddenPath);

const legacy=[
  'client/windows-native/GptOperator.Client/RealRemoteDesktopSession.cs',
  'client/windows-native/GptOperator.Client/RealRemoteHelper.cs',
  'client/windows-native/GptOperator.Client/TrayApplicationContext.RealRemote.cs',
  'client/windows-native/GptOperator.RealRemoteV2/HaloForm.cs',
  'lib/real-remote-companion-rpc.mjs'
];
for(const rel of legacy)need(!exists(rel),'legacy_rm_v1_path_present:'+rel);

need(exists('client/windows-native/GptOperator.RealRemoteV2/GptOperator.RealRemoteV2.csproj'),'rmv2_project_missing');
const runtime=read('operator-host/executor-routes-runtime.mjs');
need(runtime.includes("'desktop'")&&runtime.includes('startDesktopOperation'),'rmv2_runtime_route_missing');
const agent=read('device-agent/operator-agent.mjs');
need(agent.includes('DeviceDuplexClient')&&agent.includes('REAL_REMOTE_LIVE'),'rmv2_device_duplex_missing');

console.log('v091-golden-release-scope-rc30=PASS');
