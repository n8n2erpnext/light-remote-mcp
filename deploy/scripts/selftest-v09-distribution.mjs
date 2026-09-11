import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const text=file=>fs.readFileSync(path.join(root,file),'utf8');
function expect(value,message){if(!value)throw new Error(message);}

expect(text('VERSION').trim()==='0.9.0-beta.1','beta_version_file_invalid');
expect(text('LICENSE').includes('Apache License')&&text('LICENSE').includes('Version 2.0'),'apache_license_missing');
expect(text('NOTICE').includes('Light Remote MCP'),'notice_missing');
expect(text('package.json').includes('"license": "Apache-2.0"'),'root_package_license_missing');
expect(text('gateway/package.json').includes('"license": "Apache-2.0"'),'gateway_package_license_missing');
expect(text('deploy/server-linux/install.sh').includes('--wall-bind'),'server_wall_bind_option_missing');
expect(text('deploy/server-linux/install.sh').includes('OPERATOR_PUBLIC_KEYS_JSON value'),'server_public_key_handoff_missing');
expect(text('.github/workflows/server-linux-build.yml').includes('arch: [x64, arm64]'),'server_arch_matrix_missing');
expect(text('.github/workflows/linux-client-build.yml').includes('Light-Remote-MCP-Client-Linux-${{ matrix.arch }}-0.9.0-beta.1.tar.gz'),'linux_client_artifact_upload_name_mismatch');
expect(!text('.github/workflows/linux-client-build.yml').includes('GPT-Operator-Agent-Linux-${{ matrix.arch }}-dev.tar.gz'),'stale_linux_client_artifact_name_present');
expect(text('.github/workflows/vercel-bridge-package.yml').includes('vercel-bridge-package-contract=PASS'),'vercel_bundle_ci_missing');
expect(text('lib/operator-crypto.js').includes('OPERATOR_PUBLIC_KEYS_JSON'),'vercel_public_key_env_override_missing');
expect(text('README.md').includes('## Quick start — self-hosted beta'),'readme_beta_quickstart_missing');
expect(text('README.md').includes('ChatGPT Plus today — Vercel bridge is the required control path'),'readme_plus_vercel_path_missing');
expect(text('README.md').includes('The direct `/mcp` OAuth lane remains'),'readme_direct_mcp_boundary_missing');
const workspaceProbe=spawnSync(process.execPath,['--input-type=module','-e',
  "import {rootNames} from './gateway/workspace.mjs'; console.log(JSON.stringify(rootNames()));"],{
  cwd:root,encoding:'utf8',env:{...process.env,MCP_WORKSPACE_ROOTS_JSON:'{"project":"/workspace/project"}'}
});
expect(workspaceProbe.status===0,`workspace_probe_failed:${workspaceProbe.stderr}`);
expect(workspaceProbe.stdout.trim()==='["project"]','workspace_env_not_authoritative');

for(const script of ['deploy/server-linux/install.sh','deploy/server-linux/build-bundle.sh','deploy/vercel/build-bundle.sh']){
  const check=spawnSync('bash',['-n',path.join(root,script)],{encoding:'utf8'});
  expect(check.status===0,`${script}_syntax:${check.stderr}`);
}

const out=fs.mkdtempSync(path.join(os.tmpdir(),'lrm-vercel-bundle-'));
try{
  const build=spawnSync('bash',[path.join(root,'deploy/vercel/build-bundle.sh')],{cwd:root,encoding:'utf8',env:{...process.env,OUT_DIR:out}});
  expect(build.status===0,`vercel_bundle_build_failed:${build.stderr}`);
  const archive=path.join(out,'Light-Remote-MCP-Vercel-Bridge-0.9.0-beta.1.tar.gz');
  expect(fs.existsSync(archive),'vercel_bundle_missing');
  const listing=spawnSync('tar',['-tzf',archive],{encoding:'utf8'});
  expect(listing.status===0,'vercel_bundle_tar_invalid');
  for(const required of ['api/operator.js','lib/operator-crypto.js','DEPLOY.md','LICENSE','NOTICE','vercel.json','operator-public-keys.json'])
    expect(listing.stdout.includes(`light-remote-mcp-vercel/${required}`),`vercel_bundle_missing:${required}`);
  const extract=spawnSync('tar',['-xzf',archive,'-C',out,'light-remote-mcp-vercel/operator-public-keys.json'],{encoding:'utf8'});
  expect(extract.status===0,'vercel_placeholder_key_extract_failed');
  const placeholder=JSON.parse(fs.readFileSync(path.join(out,'light-remote-mcp-vercel/operator-public-keys.json'),'utf8'));
  expect(!placeholder.currentKid&&Object.keys(placeholder.keys||{}).length===0,'vercel_bundle_must_not_ship_reference_operator_key');
} finally { fs.rmSync(out,{recursive:true,force:true}); }

console.log('v09-distribution-license=PASS');
console.log('v09-distribution-selfhost-contract=PASS');
console.log('v09-distribution-vercel-bundle=PASS');
