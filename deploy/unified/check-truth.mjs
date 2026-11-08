import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const project=read('project.manifest.json'),checkpoint=read('MASTER_CHECKPOINT.json');
if(project.repository!=='n8n2erpnext/light-remote-mcp'||checkpoint.officialRepository!==project.repository||checkpoint.version!==project.version)
 throw Error('unified_truth_identity_mismatch');
if(fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()!==project.version)
 throw Error('unified_version_mismatch');
for(const rel of ['package.json','plugin-server/package.json','client/desktop-v4/package.json','client/desktop-v4/src-tauri/tauri.conf.json'])
 if(read(rel).version!==project.version)throw Error('unified_component_version_mismatch:'+rel);
if(fs.existsSync(path.join(root,'.light-remote/CURRENT_CHECKPOINT.json'))||fs.existsSync(path.join(root,'.git/objects/info/alternates')))
 throw Error('unified_legacy_checkpoint_or_object_dependency');
for(const rel of ['PROJECT_TRUTH.md','MASTER_CHECKPOINT.json','ARCHITECTURE.md','PROJECT_HANDOFF.md','MIGRATION_PROVENANCE.md','API_INTEGRATION_MATRIX.md','FEATURE_STATUS_MATRIX.md','REGRESSION_BASELINE.md','BUILD_AND_DEPLOYMENT.md','DEV_ENVIRONMENT.md','KNOWN_ISSUES.md','ROADMAP.md','RECOVERY_AND_ROLLBACK.md','COMPONENT_INVENTORY.md'])
 if(!fs.existsSync(path.join(root,rel)))throw Error('unified_required_document_missing:'+rel);
if(process.argv.includes('--staged')){
 const out=spawnSync('git',['diff','--cached','--name-only','-z'],{cwd:root,encoding:'utf8'});
 if(out.status!==0)throw Error('unified_staged_read_failed');
 const changed=out.stdout.split('\0').filter(Boolean);
 const source=changed.some(p=>/\.(mjs|js|ts|tsx|rs|cs|sql|ps1|sh|yml|yaml|toml|csproj)$/.test(p)||p==='project.manifest.json'||p==='VERSION');
 if(source&&!['PROJECT_TRUTH.md','MASTER_CHECKPOINT.json'].every(p=>changed.includes(p)))
  throw Error('unified_source_requires_current_truth_and_checkpoint');
}
console.log('UNIFIED_PROJECT_TRUTH=PASS');
