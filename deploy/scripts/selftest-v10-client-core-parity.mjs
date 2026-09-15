import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-core-parity-'));
const spec=JSON.parse(fs.readFileSync(path.join(root,'client/core-files.json'),'utf8')),need=(v,m)=>{if(!v)throw new Error(m);};
const adapterFiles=fs.readdirSync(path.join(root,'device-agent/platform-adapters')).filter(x=>x.endsWith('.mjs')).sort();
const stagedAdapters=spec.files.filter(x=>x.source.startsWith('device-agent/platform-adapters/')).map(x=>path.basename(x.source)).sort();
need(JSON.stringify(adapterFiles)===JSON.stringify(stagedAdapters),`client_core_adapter_inventory_drift:${adapterFiles}:${stagedAdapters}`);
const digests=[];
try{
  for(const lane of ['windows','macos','linux-desktop','linux-vps']){
    const target=path.join(tmp,lane),stage=spawnSync(process.execPath,[path.join(root,'deploy/scripts/stage-client-core.mjs'),target],{cwd:root,encoding:'utf8'});need(stage.status===0,`client_core_stage_failed:${lane}:${stage.stderr}`);
    const verify=spawnSync(process.execPath,[path.join(root,'deploy/scripts/stage-client-core.mjs'),'--verify',target],{cwd:root,encoding:'utf8'});need(verify.status===0,`client_core_verify_failed:${lane}:${verify.stderr}`);
    const meta=JSON.parse(fs.readFileSync(path.join(target,'client-core.json'),'utf8'));digests.push(meta.digest);need(meta.version===fs.readFileSync(path.join(root,'VERSION'),'utf8').trim(),`client_core_version_drift:${lane}`);
  }
  need(new Set(digests).size===1,'client_core_cross_platform_digest_drift');
  for(const wf of ['linux-client-build.yml','macos-client-build.yml','windows-native-client.yml']){
    const text=fs.readFileSync(path.join(root,'.github/workflows',wf),'utf8');need(text.includes('stage-client-core.mjs'),`workflow_missing_canonical_stager:${wf}`);need(text.includes("lib/runtime-version.mjs"),`workflow_missing_runtime_version_trigger:${wf}`);for(const shared of ['lib/version-compat.mjs','lib/brand.mjs','lib/update-helper-reconcile.mjs'])need(text.includes(shared),`workflow_missing_shared_core_trigger:${wf}:${shared}`);
  }
  const linux=fs.readFileSync(path.join(root,'.github/workflows/linux-client-build.yml'),'utf8');need(linux.includes('client/linux-debian/build-deb.sh "$BUNDLE"'),'linux_desktop_not_derived_from_vps_core_bundle');
  const windowsVersion=fs.readFileSync(path.join(root,'client/windows-native/GptOperator.Client/ClientVersion.cs'),'utf8');need(windowsVersion.includes('0.9.0-dev')&&!windowsVersion.includes('0.9.0-rc.6'),'windows_version_fallback_stale');
  console.log(`v10-client-core-parity=PASS digest=${digests[0]} files=${spec.files.length}`);
  console.log('v10-client-core-linux-desktop-vps-single-source=PASS');
  console.log('v10-client-core-workflow-trigger-parity=PASS');
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
