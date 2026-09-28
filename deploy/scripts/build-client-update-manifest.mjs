import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [assetArg,baseArg,outArg]=process.argv.slice(2);
if(!assetArg||!baseArg)throw new Error('usage: node deploy/scripts/build-client-update-manifest.mjs <asset-dir> <https-base-url> [output]');
const assets=path.resolve(assetArg),base=String(baseArg).replace(/\/$/,''),version=fs.readFileSync(path.join(repo,'VERSION'),'utf8').trim();
if(!/^https:\/\//i.test(base))throw new Error('update_base_url_must_be_https');
const names={
  'windows-x64':`Light-Remote-MCP-Setup-x64-${version}.exe`,
  'macos-x64':`Light-Remote-Client-macOS-x64-${version}.tar.gz`,
  'macos-arm64':`Light-Remote-Client-macOS-arm64-${version}.tar.gz`,
  'linux-x64':`Light-Remote-MCP-Client-Linux-x64-${version}.tar.gz`,
  'linux-arm64':`Light-Remote-MCP-Client-Linux-arm64-${version}.tar.gz`
};
const artifacts={};
for(const [platform,name] of Object.entries(names)){
  const file=path.join(assets,name);if(!fs.existsSync(file))throw new Error(`update_artifact_missing:${platform}:${name}`);
  const bytes=fs.readFileSync(file);artifacts[platform]={url:`${base}/${encodeURIComponent(name)}`,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length};
  if(platform==='windows-x64')artifacts[platform].installerArgs='/SILENT /NORESTART';
}
const manifest={schemaVersion:1,channel:'beta',version,artifacts};
const output=path.resolve(outArg||path.join(assets,'client-update.json'));fs.writeFileSync(output,`${JSON.stringify(manifest,null,2)}\n`);
console.log(`client_update_manifest=${output}`);console.log(`client_update_version=${version}`);console.log(`client_update_platforms=${Object.keys(artifacts).join(',')}`);console.log('client_update_signature_required=external');
