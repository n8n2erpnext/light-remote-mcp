#!/usr/bin/env node
// Unified Project Book: generate derived catalogs and validate canonical source links.
// Offline/documentation-only: no remote runtime calls, no git history rewriting.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const shelf=path.join(root,'docs/project-book');
const mode=process.argv[2];
if(!['--write','--check'].includes(mode)){
  console.error('Usage: node deploy/unified/project-book.mjs --write|--check');
  process.exit(2);
}
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const project=readJson('project.manifest.json');
const checkpoint=readJson('MASTER_CHECKPOINT.json');
const artifact=checkpoint.evidence?.windows||{};
const ci=checkpoint.evidence?.currentRepositoryCi||{};
const dev=checkpoint.evidence?.dev||{};
const truth={
  schemaVersion:'light-remote.unified.project-truth-status.v1',
  generatedFrom:['project.manifest.json','MASTER_CHECKPOINT.json','contracts/api.v1.json','config/endpoints.json'],
  repository:project.repository,
  activeCheckpoint:'MASTER_CHECKPOINT.json',
  projectVersion:project.version,
  apiContractVersion:project.apiContractVersion,
  profile:project.defaultBuildProfile,
  officialRepositoryId:checkpoint.repositoryId,
  verifiedBuiltSourceCommit:checkpoint.baselineSourceCommit,
  verifiedBuiltSourceTree:checkpoint.baselineSourceTree,
  checkpointUpdatedAt:checkpoint.updatedAt,
  migrationPhase:checkpoint.phase,
  ci:{
    status:ci.conclusion||'NOT_VERIFIED',
    runId:ci.runId||null,
    sourceCommit:ci.sourceCommit||null,
    passedJobs:ci.passedJobs??null,
    totalJobs:ci.jobs??null
  },
  isolatedDev:{
    sourceCommit:dev.sourceCommit||null,
    checks:dev.checks??null,
    status:dev.result||'NOT_VERIFIED',
    evidence:'docs/evidence/dev-integration.json'
  },
  windows:{
    sourceCommit:artifact.sourceCommit||null,
    artifactId:artifact.artifactId||null,
    sha256:artifact.installerSha256||null,
    physicalOwnerAcceptance:artifact.physicalAcceptance===true?'PASS':'NOT_RUN'
  },
  sourcePresenceDoesNotProveDeployment:true,
  productionRelease:project.productionRelease===true,
  remaining:checkpoint.remaining||[],
  historicalRefsOnly:{
    oldRepository:'n8n2erpnext/light-remote-mcp-archive-20261108',
    auditedArmSnapshot:checkpoint.originAuditedSnapshot||null
  }
};
if(truth.repository!=='n8n2erpnext/light-remote-mcp'||checkpoint.officialRepository!==truth.repository||
   truth.apiContractVersion!==readJson('contracts/api.v1.json').contractVersion)
  throw Error('project_book_identity_or_api_mismatch');
if(checkpoint.documentation?.activeCheckpoint!=='MASTER_CHECKPOINT.json')
  throw Error('book_must_reference_only_active_master_checkpoint');
if(fs.existsSync(path.join(root,'.light-remote/CURRENT_CHECKPOINT.json')))
  throw Error('obsolete_checkpoint_must_not_be_restored');
const required=[
 'README.md','LIBRARY_RULES.md','DOCUMENT_LIBRARY_MAP.md',
 'DOCUMENT_TEMPLATE.md','LIGHT_REMOTE_PROJECT_BOOK.md',
 'LIGHT_REMOTE_CODE_MAP.md','LIGHT_REMOTE_WORKLOG.md'
];
for(const file of required)if(!fs.existsSync(path.join(shelf,file)))throw Error('missing_book_file:'+file);
const truthPath=path.join(shelf,'PROJECT_TRUTH_STATUS.json');
const truthText=JSON.stringify(truth,null,2)+'\n';
if(mode==='--write')fs.writeFileSync(truthPath,truthText);
else if(!fs.existsSync(truthPath)||fs.readFileSync(truthPath,'utf8')!==truthText)
 throw Error('project_book_status_out_of_sync');

const catalog=spawnSync(process.execPath,['deploy/scripts/generate-doc-catalog.mjs',mode],{
 cwd:root,encoding:'utf8'
});
if(catalog.status!==0)throw Error('project_book_catalog_drift: '+(catalog.stderr||catalog.stdout));
const paths=fs.readdirSync(shelf).filter(f=>f.endsWith('.md'));
let links=0;
for(const file of paths){
 const source=fs.readFileSync(path.join(shelf,file),'utf8');
 for(const match of source.matchAll(/\]\(([^)]+)\)/g)){
   const link=match[1].split('#')[0].split('?')[0];
   if(!link||/^(https?:|mailto:|#)/i.test(link))continue;
   const absolute=path.resolve(shelf,decodeURIComponent(link));
   if(!absolute.startsWith(root+path.sep)||!fs.existsSync(absolute))
     throw Error('project_book_broken_link:'+file+':'+link);
   links++;
 }
}
const map=fs.readFileSync(path.join(shelf,'LIGHT_REMOTE_CODE_MAP.md'),'utf8');
const endpoints=readJson('config/endpoints.json');
let routeChecks=0;
for(const line of map.split('\n')){
 const fields=line.split('|').map(x=>x.trim());
 if(fields.length!==6||!/^([A-Za-z][A-Za-z0-9]+)$/.test(fields[1]))continue;
 const name=fields[1];
 const definition=endpoints.routeCatalog?.[name]||endpoints.internalRoutes?.[name];
 if(!definition)continue;
 if(fields[3]!==definition.method||fields[4]!==definition.path)
   throw Error('project_book_route_drift:'+name);
 routeChecks++;
}
if(routeChecks<10)throw Error('project_book_missing_canonical_route_inventory');
console.log('UNIFIED_PROJECT_BOOK=PASS mode='+mode+' links='+links+' routeChecks='+routeChecks);
