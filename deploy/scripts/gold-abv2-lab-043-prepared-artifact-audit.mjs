#!/usr/bin/env node
/**
 * Read-only evidence audit of one pinned LAB-ONLY 043 source artifact.
 * Never approves a release, starts a service, runs SQL migrations or enables SSO.
 * This is NOT a replacement for the canonical Git42 source preflight.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const LAB='light-remote-abv2-lab-20261101';
const ORIGINAL='/opt/light-remote-abv2-lab/source-b8ec5d6f-t04b8-a2-MTLS-STAGED';
const PREPARED='/opt/light-remote-abv2-lab/source-b8ec5d6f-t04b8-a2-LAB043-COMPAT-PREPARED';
const LOCK='platform-v2/sql/migrations.lock.json';
const SQL43='043_gold_device_short_ids.sql';
const PIN='9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609';
const SQL_PIN='935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const run=(bin,args,opts={})=>execFileSync(bin,args,{
  encoding:'utf8',timeout:25000,maxBuffer:1024*512,...opts}).trim();
const lxc=args=>run('lxc',['exec',LAB,'--',...args]);
const ordered=(m,n)=>m?.target==='light_remote_gold_dev - independent Gold only'&&
  Array.isArray(m?.migrations)&&m.migrations.length===n&&
  m.migrations.every((row,i)=>row?.version===i+1&&
    typeof row.file==='string'&&/^[a-f0-9]{64}$/.test(row.sha256??''));

export function evaluatePreparedArtifact({
  canonical,canonicalCommitted=false,canonicalDigests={},proposed,
  preparedLockSha='',preparedDigests={},preparedStage='',treeIdenticalExceptLock=false,
  resolvedModules={},importClosure={},review={},labUnits=[],pluginStillOldSource=false,
  operatorStillOldSource=false
}={}){
  const blockers=[];
  if(!ordered(canonical,42))blockers.push('canonical_git42_invalid');
  if(!canonicalCommitted)blockers.push('canonical_git42_not_committed');
  if(ordered(canonical,42)&&canonical.migrations.some(r=>canonicalDigests[r.file]!==r.sha256))
    blockers.push('canonical_sql_digest_mismatch');
  if(preparedStage!==PREPARED)blockers.push('prepared_lab_only_stage_not_exact');
  if(!ordered(proposed,43))blockers.push('prepared_lock43_invalid');
  if(ordered(canonical,42)&&ordered(proposed,43)&&
     JSON.stringify(proposed.migrations.slice(0,42))!==JSON.stringify(canonical.migrations))
    blockers.push('prepared_parent42_drift');
  if(proposed?.migrations?.[42]?.file!==SQL43||
     proposed?.migrations?.[42]?.sha256!==SQL_PIN)
    blockers.push('prepared_043_not_exact_sql_pin');
  if(preparedLockSha!==PIN)blockers.push('prepared_lock_sha_not_expected');
  if(ordered(proposed,43)&&proposed.migrations.some(r=>preparedDigests[r.file]!==r.sha256))
    blockers.push('prepared_sql_digest_mismatch');
  if(!treeIdenticalExceptLock)blockers.push('source_copy_differs_outside_lab_lock');
  if(resolvedModules.plugin_express!==true||resolvedModules.operator_pg!==true)
    blockers.push('stage_node_module_resolution_failed');
  if(!Number.isInteger(importClosure.checkedFiles)||importClosure.checkedFiles<1||
    !Number.isInteger(importClosure.staticReferences)||importClosure.staticReferences<1||
    importClosure.missingCount!==0)
    blockers.push('static_external_module_closure_not_proven');
  if(!Number.isInteger(importClosure.relativeReferences)||importClosure.relativeReferences<1||
    importClosure.relativeMissingCount!==0)
    blockers.push('static_relative_module_closure_not_proven');
  if(importClosure.computedImportCandidates!==1||
    importClosure.unexpectedComputedImports!==0)
    blockers.push('computed_import_inventory_not_pinned');
  if(review?.status!=='LAB_ONLY_COMPATIBILITY_PROPOSAL_REPRODUCIBLE'||
    review?.actualLabLedger!==43||review?.canonicalGitLockedThrough!==42||
    review?.proposedLabOnlyLockSha256!==PIN||review?.sql043Sha256!==SQL_PIN||
    review?.releaseApproved!==false||review?.canCutover!==false||
    !Array.isArray(review?.blockers)||review.blockers.length)
    blockers.push('real_lab_043_provenance_review_missing');
  if(labUnits.length!==4||labUnits.some(x=>x!=='active'))
    blockers.push('lab_units_not_all_healthy');
  if(!pluginStillOldSource||!operatorStillOldSource)
    blockers.push('running_source_changed_during_artifact_review');
  return Object.freeze({
    status:blockers.length?'BLOCKED':'LAB_ONLY_043_PREPARED_ARTIFACT_COMPATIBLE_NOT_RELEASED',
    targetLab:LAB,preparedStage:PREPARED,canonicalLockVersion:42,
    labOnlyLockVersion:43,lockSha256:preparedLockSha,
    staticDependencyClosure:{
      checkedFiles:importClosure.checkedFiles??0,
      checkedExternalReferences:importClosure.staticReferences??0,
      missingCount:importClosure.missingCount??null,
      checkedRelativeReferences:importClosure.relativeReferences??0,
      missingRelativeCount:importClosure.relativeMissingCount??null,
      computedImportCandidates:importClosure.computedImportCandidates??null,
      unexpectedComputedImports:importClosure.unexpectedComputedImports??null,
      qualification:'literal imports resolved statically; one known updater lifeboat dynamic import is inventoried but not runtime resolved; no module execution'
    },
    canCutover:false,releaseApproved:false,canApplyMigration:false,canEnableSso:false,
    blockers
  });
}

function sourceData(){
  const text=fs.readFileSync(path.join(ROOT,LOCK),'utf8');
  const committed=run('git',['show','HEAD:'+LOCK],{cwd:ROOT});
  const canonical=JSON.parse(text);
  const canonicalDigests={};
  for(const row of canonical.migrations??[]){
    canonicalDigests[row.file]=sha(fs.readFileSync(path.join(ROOT,'platform-v2/sql',row.file)));
  }
  return {canonical,canonicalCommitted:text.trim()===committed.trim(),canonicalDigests};
}
function preparedData(){
  // Node only reads files and resolves dependency names. No code from staged module is imported.
  const probe=[
    "const fs=require('fs'),crypto=require('crypto');",
    "const {createRequire}=require('module');",
    "const root="+JSON.stringify(PREPARED)+";",
    "const p=root+'/'+ "+JSON.stringify(LOCK)+";",
    "const raw=fs.readFileSync(p),lock=JSON.parse(raw.toString());",
    "const digest=b=>crypto.createHash('sha256').update(b).digest('hex');",
    "const digests={};for(const row of lock.migrations||[]){",
    "const file=root+'/platform-v2/sql/'+row.file;",
    "digests[row.file]=digest(fs.readFileSync(file))}",
    "const resolvedModules={};",
    "for(const [key,entry,pkg] of [['plugin_express','plugin-server/server.mjs','express'],",
    "['operator_pg','operator-host/executor.mjs','pg']]){",
    "try{createRequire(root+'/'+entry).resolve(pkg);resolvedModules[key]=true}",
    "catch{resolvedModules[key]=false}}",
    "const modulePaths=['plugin-server','operator-host','lib','platform-v2'];",
    "const patterns=[/(?:^|[;\\n])\\s*import\\s+(?:[\\w*\\s{},]+\\s+from\\s*)?['\\\"]([^'\\\"]+)['\\\"]/gm,/(?:^|[;\\n])\\s*export\\s+[\\w*\\s{},]+\\s+from\\s+['\\\"]([^'\\\"]+)['\\\"]/gm,/\\bimport\\s*\\(\\s*['\\\"]([^'\\\"]+)['\\\"]\\s*\\)/gm,/\\brequire\\s*\\(\\s*['\\\"]([^'\\\"]+)['\\\"]\\s*\\)/gm];",
    "const importClosure={checkedFiles:0,staticReferences:0,missingCount:0,relativeReferences:0,relativeMissingCount:0,computedImportCandidates:0,unexpectedComputedImports:0};",
    "const walk=(dir,depth)=>{if(depth>12||importClosure.checkedFiles>15000)return;",
    "for(const ent of fs.readdirSync(dir,{withFileTypes:true})){",
    "if(['node_modules','.git','dist','build'].includes(ent.name))continue;",
    "const f=require('path').join(dir,ent.name);",
    "if(ent.isDirectory()){walk(f,depth+1);continue}",
    "if(!ent.isFile()||!/\\.(?:mjs|cjs|js)$/.test(f))continue;",
    "importClosure.checkedFiles++;const code=fs.readFileSync(f,'utf8');",
    "const localRequire=createRequire(f);",
    "const computed=(code.match(/\\bimport\\s*\\(\\s*[^\\x27\\x22\\s]/g)||[]).length;",
    "importClosure.computedImportCandidates+=computed;",
    "const known=f===root+'/lib/update-helper-reconcile.mjs'&&code.includes('import(pathToFileURL(lifeboat).href)');",
    "importClosure.unexpectedComputedImports+=Math.max(0,computed-(known?1:0));",
    "for(const re of patterns){re.lastIndex=0;let match;",
    "while((match=re.exec(code))!==null){",
    "const spec=match[1];if(spec.startsWith('node:')||spec.startsWith('data:'))continue;",
    "if(spec.startsWith('./')||spec.startsWith('../')||spec.startsWith('/')){",
    "importClosure.relativeReferences++;",
    "try{localRequire.resolve(spec)}catch{importClosure.relativeMissingCount++}",
    "continue;}",
    "importClosure.staticReferences++;",
    "try{localRequire.resolve(spec)}catch{importClosure.missingCount++}",
    "}}}};",
    "for(const folder of modulePaths){const dir=require('path').join(root,folder);if(fs.existsSync(dir))walk(dir,0)};",
    "console.log(JSON.stringify({proposed:lock,preparedLockSha:digest(raw),digests,resolvedModules,importClosure}))"
  ].join('\n');
  return JSON.parse(lxc(['/usr/bin/node','-e',probe]));
}
function runAudit(){
  const originalStat=lxc(['test','-d',ORIGINAL]);
  const preparedStat=lxc(['test','-d',PREPARED]);
  if(originalStat||preparedStat)throw Error('stage_absent');
  let treeIdenticalExceptLock=false;
  try{
    // diff -q does not change files, and does not dereference symlinked node_modules.
    const output=lxc(['diff','-qr','--exclude=migrations.lock.json',ORIGINAL,PREPARED]);
    treeIdenticalExceptLock=output==='';
  }catch{treeIdenticalExceptLock=false;}
  const stage=preparedData();
  const review=JSON.parse(run('node',
    [path.join(ROOT,'deploy/scripts/gold-abv2-lab-043-compatibility-review.mjs'),'--review']));
  const labUnits=lxc(['systemctl','is-active','light-remote-gold-plugin',
    'light-remote-gold-operator','light-remote-gold-wall',
    'light-remote-gold-process-supervisor']).split('\n');
  const plugin=lxc(['systemctl','show','light-remote-gold-plugin','-p','ExecStart','--no-pager']);
  const operator=lxc(['systemctl','show','light-remote-gold-operator','-p','ExecStart','--no-pager']);
  const result=evaluatePreparedArtifact({...sourceData(),proposed:stage.proposed,
    preparedLockSha:stage.preparedLockSha,preparedDigests:stage.digests,
    preparedStage:PREPARED,treeIdenticalExceptLock,
    resolvedModules:stage.resolvedModules,importClosure:stage.importClosure,review,labUnits,
    pluginStillOldSource:plugin.includes('source-9d996956-desktop-owner-plugin-STAGED'),
    operatorStillOldSource:operator.includes('source-9d996956-desktop-owner-operator-STAGED')});
  console.log(JSON.stringify(result,null,2));
  if(result.status==='BLOCKED')process.exitCode=3;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--audit'){
    console.error('LAB043_PREPARED_ARTIFACT_READ_ONLY_USAGE: --audit');
    process.exitCode=2;
  }else{
    try{runAudit()}
    catch{console.error('LAB043_PREPARED_ARTIFACT_EVIDENCE_UNAVAILABLE');process.exitCode=4}
  }
}
