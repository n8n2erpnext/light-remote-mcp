#!/usr/bin/env node
/**
 * GoldABV2 Lab source-cutover preflight. READ ONLY and intentionally has no --apply.
 * A compatibility PASS never constitutes migration release approval or SSO authorization.
 * This script only targets light-remote-abv2-lab-20261101 and its isolated PostgreSQL.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const LAB='light-remote-abv2-lab-20261101';
const root=fileURLToPath(new URL('../../',import.meta.url));
const lockRel='platform-v2/sql/migrations.lock.json';

export function evaluateLabCutoverPreflight({versions,canonicalLock,stagedLock,
    stagedDigests={},canonicalDigests={},modules={},shortIdTable=false,
    immutableTrigger=false,ownerAuthorityTable=false,ownerHandoffsTable=false,
    guestTableAbsent=false,canonicalCommitted=true}={}){
  const blockers=[];
  const ordered=Array.isArray(versions)&&versions.length>0&&versions.length<=44&&
    versions.every((v,i)=>Number.isInteger(v)&&v===i+1);
  if(!ordered)blockers.push('database_ledger_not_contiguous');
  const last=ordered?versions.length:null;
  const entries=(manifest)=>Array.isArray(manifest?.migrations)?manifest.migrations:[];
  const canonical=entries(canonicalLock),staged=entries(stagedLock);
  const validRows=(rows)=>rows.length>0&&rows.length<=44&&
    rows.every((r,i)=>r?.version===i+1&&typeof r.file==='string'&&
      /^[0-9a-f]{64}$/.test(r.sha256??''));
  if(!validRows(canonical))blockers.push('canonical_lock_invalid');
  if(!validRows(staged))blockers.push('staged_lock_invalid');
  if(!canonicalCommitted)blockers.push('canonical_lock_not_committed');
  if(validRows(canonical)&&validRows(staged)&&
      JSON.stringify(canonical)!==JSON.stringify(staged))
    blockers.push('staged_lock_differs_from_canonical');
  if(ordered&&staged.length!==last)blockers.push('database_version_vs_staged_lock_mismatch');
  if(ordered&&canonical.length!==last)blockers.push('database_version_vs_canonical_lock_mismatch');
  if(last>=43&&(!shortIdTable||!immutableTrigger))
    blockers.push('schema043_table_or_trigger_missing');
  // Lab-only Owner 045 was applied outside the 001..043 ledger.
  // This does NOT authorize a canonical 045 release to Gold UAT/production.
  if(!ownerAuthorityTable||!ownerHandoffsTable)
    blockers.push('lab_only_owner045_tables_missing');
  if(!guestTableAbsent)blockers.push('lab_guest044_schema_present');
  if(last>=44)blockers.push('schema044_guest_runtime_hold');
  if(validRows(canonical)){
    for(const row of canonical){
      if(canonicalDigests[row.file]!==row.sha256){
        blockers.push('canonical_sql_digest_missing_or_mismatched');
        break;
      }
    }
  }
  if(validRows(staged)){
    for(const row of staged){
      if(stagedDigests[row.file]!==row.sha256){
        blockers.push('staged_sql_digest_missing_or_mismatched');
        break;
      }
    }
  }
  for(const key of ['plugin_express','operator_pg']){
    if(modules[key]!==true)blockers.push(key+'_unresolved');
  }
  return Object.freeze({
    status:blockers.length?'BLOCKED':'COMPATIBLE_ONLY_RELEASE_APPROVAL_NOT_VERIFIED',
    canCutover:false, // MUST be explicitly approved outside this compatibility check.
    databaseVersion:last,canonicalLockVersion:canonical.at(-1)?.version??null,
    stagedLockVersion:staged.at(-1)?.version??null,
    blockers
  });
}

function exec(bin,args,opts={}){
  return execFileSync(bin,args,{encoding:'utf8',timeout:16000,maxBuffer:1024*128,...opts}).trim();
}

function inspectStaged(source){
  // The child uses filesystem reads and require.resolve only; NO module imports, service or DB writes.
  const probe=[
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import crypto from 'node:crypto';",
    "import {createRequire} from 'node:module';",
    "const root=process.argv[1];",
    "const lock=JSON.parse(fs.readFileSync(path.join(root,'platform-v2/sql/migrations.lock.json'),'utf8'));",
    "const digests={};",
    "for(const row of lock.migrations||[]){",
    "const p=path.join(root,'platform-v2/sql',row.file);",
    "digests[row.file]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');",
    "}",
    "const modules={};",
    "for(const [label,entry,pkg] of [['plugin_express','plugin-server/server.mjs','express'],['operator_pg','operator-host/executor.mjs','pg']]){",
    "try {const req=createRequire(path.join(root,entry));req.resolve(pkg);modules[label]=true}",
    "catch {modules[label]=false}",
    "}",
    "console.log(JSON.stringify({lock,digests,modules}));"
  ].join('\n');
  return JSON.parse(exec('lxc',['exec',LAB,'--','/usr/bin/node','--input-type=module',
    '--eval',probe,'--',source]));
}

function readLedger(){
  const sql=[
    'BEGIN TRANSACTION READ ONLY;',
    "SELECT string_agg(version::text,',' ORDER BY version),",
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
  const out=exec('lxc',['exec',LAB,'--','runuser','-u','postgres','--','psql',
    '-X','-A','-t','-v','ON_ERROR_STOP=1','-d','light_remote_gold_dev','-c',sql]);
  const record=out.split('\n').find(line=>/^[0-9,]*\|[tf]\|[tf]\|[tf]\|[tf]\|[tf]$/.test(line));
  if(!record)throw Error('invalid_schema_ledger_response');
  const [raw,table,trigger,ownerAuthority,handoffs,guestAbsent]=record.split('|');
  return {versions:raw.split(',').map(Number),shortIdTable:table==='t',
    immutableTrigger:trigger==='t',ownerAuthorityTable:ownerAuthority==='t',
    ownerHandoffsTable:handoffs==='t',guestTableAbsent:guestAbsent==='t'};
}

function main(){
  const args=process.argv.slice(2);
  if(args.length!==3||args[0]!=='--preflight'||args[1]!=='--source'||
     !/^\/opt\/light-remote-abv2-lab\/source-[A-Za-z0-9._-]+$/.test(args[2])){
    console.error('LAB_PREFLIGHT_READ_ONLY_USAGE: --preflight --source /opt/light-remote-abv2-lab/source-<id>');
    process.exitCode=2;return;
  }
  try{
    const canonicalText=fs.readFileSync(path.join(root,lockRel),'utf8');
    const committedText=exec('git',['show','HEAD:'+lockRel],{cwd:root});
    const canonicalCommitted=canonicalText.trim()===committedText.trim();
    const canonicalLock=JSON.parse(canonicalText);
    const canonicalDigests={};
    for(const row of canonicalLock.migrations||[]){
      const sql=fs.readFileSync(path.join(root,'platform-v2/sql',row.file));
      canonicalDigests[row.file]=crypto.createHash('sha256').update(sql).digest('hex');
    }
    const stage=inspectStaged(args[2]);
    const ledger=readLedger();
    const result=evaluateLabCutoverPreflight({
      ...ledger,canonicalLock,stagedLock:stage.lock,
      stagedDigests:stage.digests,canonicalDigests,modules:stage.modules,canonicalCommitted
    });
    console.log(JSON.stringify({
      preflight:'gold-abv2-isolated-lab-only',sourceFolder:path.basename(args[2]),
      ...result
    },null,2));
    if(result.status==='BLOCKED')process.exitCode=3;
  }catch{
    // Fail closed; never print command output, PG connection strings, or secrets.
    console.error('LAB_PREFLIGHT_READ_ONLY_INSPECTION_FAILED');
    process.exitCode=4;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main();
