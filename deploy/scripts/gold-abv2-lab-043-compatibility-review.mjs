#!/usr/bin/env node
/**
 * GoldABV2 043 lab-only provenance/compatibility REVIEW, never an installer.
 * Scope is the fixed independent test Lab. NO --apply, --write, --stage, --approve,
 * migration runner, service restart, env modification, or credential read.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const LAB='light-remote-abv2-lab-20261101';
const LOCK='platform-v2/sql/migrations.lock.json';
const FILE043='043_gold_device_short_ids.sql';
const EXPECTED_TARGET='light_remote_gold_dev - independent Gold only';
const EXPECTED_SQL043='935b268899c7b59761781db33d8ad2c573773566844fbfab0b861046f3a680d4';
const EXPECTED_LOCAL_LOCK='9fc28935ab474d8c299b2434fcb36c7b337b377284670fa203d9c5521087f609';
const EXPECTED_APPLIED='2026-11-01 15:25:05.798104';
const STAGES=Object.freeze({
  oldOperator:'/opt/light-remote-abv2-lab/source-9d996956-desktop-owner-operator-STAGED',
  oldPlugin:'/opt/light-remote-abv2-lab/source-9d996956-desktop-owner-plugin-STAGED',
  newStage:'/opt/light-remote-abv2-lab/source-b8ec5d6f-t04b8-a2-MTLS-STAGED'
});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const validEntries=(m,n)=>m?.target===EXPECTED_TARGET &&
  Array.isArray(m.migrations)&&m.migrations.length===n&&
  m.migrations.every((r,i)=>r?.version===i+1&&
    typeof r.file==='string'&&/^[a-f0-9]{64}$/.test(r.sha256??''));

export function reviewLab043Compatibility({
  canonical,canonicalSqlDigests={},canonicalCommitted=false,
  stageData={},db={},sql043Sha,expectedLocalLock=EXPECTED_LOCAL_LOCK
}={}){
  const blockers=[];
  const has42=validEntries(canonical,42);
  if(!has42)blockers.push('canonical_lock_not_042');
  if(!canonicalCommitted)blockers.push('canonical_git_lock_not_committed');
  if(sql043Sha!==EXPECTED_SQL043)blockers.push('sql043_digest_not_pinned');
  if(has42&&canonical.migrations.some(r=>canonicalSqlDigests[r.file]!==r.sha256))
    blockers.push('canonical_sql_digest_mismatch');
  const hypothetical=has42?{...canonical,migrations:[
    ...canonical.migrations,{version:43,file:FILE043,sha256:sql043Sha}
  ]}:null;
  const proposedBytes=hypothetical?JSON.stringify(hypothetical,null,2)+'\n':null;
  const proposedSha=proposedBytes?sha(proposedBytes):null;
  if(proposedSha!==expectedLocalLock)blockers.push('proposed_lock_fingerprint_unexpected');
  for(const key of ['oldOperator','oldPlugin','newStage']){
    const actual=stageData[key];
    if(!actual?.manifest){
      blockers.push(key+'_not_inspected');continue;
    }
    const expectedCount=key==='newStage'?42:43;
    if(!validEntries(actual.manifest,expectedCount)){
      blockers.push(key+'_lock_shape_invalid');continue;
    }
    if(has42&&JSON.stringify(actual.manifest.migrations.slice(0,42))!==
        JSON.stringify(canonical.migrations))blockers.push(key+'_parent_lock_drift');
    if(key==='newStage'){
      if(actual.manifest.migrations.length!==42)
        blockers.push('new_stage_unexpected_schema');
    }else{
      const last=actual.manifest.migrations[42];
      if(last?.file!==FILE043||last.sha256!==EXPECTED_SQL043)
        blockers.push(key+'_043_unreviewed');
      if(actual.lockSha!==proposedSha)blockers.push(key+'_pin_not_reproducible');
    }
    if(actual.sql043Sha!==EXPECTED_SQL043)
      blockers.push(key+'_sql043_digest_mismatch');
  }
  if(!Array.isArray(db.versions)||db.versions.length!==43||
    db.versions.some((v,i)=>v!==i+1))
    blockers.push('actual_lab_ledger_not_001_to_043');
  if(db.applied043Utc!==EXPECTED_APPLIED)
    blockers.push('lab_043_application_provenance_unexpected');
  for(const flag of ['shortIdTable','immutableTrigger','ownerAuthorityTable',
    'ownerHandoffsTable','guestAbsent']){
    if(db[flag]!==true)blockers.push('lab_'+flag+'_not_verified');
  }
  return Object.freeze({
    status:blockers.length?'BLOCKED':'LAB_ONLY_COMPATIBILITY_PROPOSAL_REPRODUCIBLE',
    canCutover:false,releaseApproved:false,canApplyMigration:false,canEnableSso:false,
    targetLab:LAB,canonicalGitLockedThrough:has42?42:null,
    actualLabLedger:db.versions?.length??null,
    proposedLabOnlyLockedThrough:hypothetical?43:null,
    proposedLabOnlyLockSha256:proposedSha,
    sql043Sha256:sql043Sha??null,
    reviewScope:'isolated Lab only; no Global Git lock change; no production or Gold UAT migration',
    blockers
  });
}
const exec=(bin,args,opts={})=>execFileSync(bin,args,{encoding:'utf8',timeout:18000,
  maxBuffer:1024*160,...opts}).trim();
function inspectTrees(){
  const probe=[
    "const fs=require('fs'),crypto=require('crypto');",
    "const sha=b=>crypto.createHash('sha256').update(b).digest('hex');",
    "const roots="+JSON.stringify(STAGES)+";",
    "const result={};",
    "for(const [key,root] of Object.entries(roots)){",
    " const lock=fs.readFileSync(root+'/platform-v2/sql/migrations.lock.json');",
    " result[key]={manifest:JSON.parse(lock.toString('utf8')),lockSha:sha(lock),",
    "  sql043Sha:sha(fs.readFileSync(root+'/platform-v2/sql/043_gold_device_short_ids.sql'))};",
    "}",
    "console.log(JSON.stringify(result));"
  ].join('\n');
  return JSON.parse(exec('lxc',['exec',LAB,'--','node','-e',probe]));
}
function inspectDb(){
  const sql=[
    'BEGIN TRANSACTION READ ONLY;',
    "SELECT string_agg(version::text,',' ORDER BY version),",
    "to_char((max(applied_at) FILTER (WHERE version=43)) AT TIME ZONE 'UTC',",
    "'YYYY-MM-DD HH24:MI:SS.US'),",
    "to_regclass('public.lr_gold_device_short_ids') IS NOT NULL,",
    "EXISTS(SELECT 1 FROM pg_trigger WHERE",
    "tgrelid=to_regclass('public.lr_gold_device_short_ids')",
    "AND tgname='lr_gold_short_id_immutable_trg' AND NOT tgisinternal),",
    "to_regclass('public.lr_gold_owner_authority') IS NOT NULL,",
    "to_regclass('public.lr_gold_owner_handoffs') IS NOT NULL,",
    "to_regclass('public.lr_gold_pro_share_guest_jobs') IS NULL",
    'FROM public.lr_schema_migrations;',
    'ROLLBACK;'
  ].join(' ');
  const output=exec('lxc',['exec',LAB,'--','runuser','-u','postgres','--',
    'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-d','light_remote_gold_dev','-c',sql]);
  const record=output.split('\n').find(s=>/^[0-9,]+\|[^|]+\|[tf]\|[tf]\|[tf]\|[tf]\|[tf]$/.test(s));
  if(!record)throw Error('lab_review_invalid_db_response');
  const [versions,applied043Utc,shortIdTable,immutableTrigger,
    ownerAuthorityTable,ownerHandoffsTable,guestAbsent]=record.split('|');
  return {versions:versions.split(',').map(Number),applied043Utc,
    shortIdTable:shortIdTable==='t',immutableTrigger:immutableTrigger==='t',
    ownerAuthorityTable:ownerAuthorityTable==='t',
    ownerHandoffsTable:ownerHandoffsTable==='t',guestAbsent:guestAbsent==='t'};
}
function main(){
  if(process.argv.length!==3||process.argv[2]!=='--review'){
    console.error('LAB043_REVIEW_READ_ONLY_USAGE: --review (no --write/--apply/--approve)');
    process.exitCode=2;return;
  }
  try{
    const lockText=fs.readFileSync(path.join(ROOT,LOCK),'utf8');
    const committed=exec('git',['show','HEAD:'+LOCK],{cwd:ROOT});
    const canonical=JSON.parse(lockText);
    const canonicalSqlDigests={};
    for(const row of canonical.migrations??[]){
      const sql=fs.readFileSync(path.join(ROOT,'platform-v2/sql',row.file));
      canonicalSqlDigests[row.file]=sha(sql);
    }
    const sql043Sha=sha(fs.readFileSync(path.join(ROOT,'platform-v2/sql',FILE043)));
    const result=reviewLab043Compatibility({
      canonical,canonicalSqlDigests,canonicalCommitted:lockText.trim()===committed.trim(),
      stageData:inspectTrees(),db:inspectDb(),sql043Sha
    });
    console.log(JSON.stringify(result,null,2));
    if(result.status==='BLOCKED')process.exitCode=3;
  }catch{
    // Do not leak source, env, database connection strings or tool stack traces.
    console.error('LAB043_REVIEW_READ_ONLY_EVIDENCE_UNAVAILABLE');
    process.exitCode=4;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main();
