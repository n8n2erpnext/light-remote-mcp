#!/usr/bin/env node
// Gold source↔documentation checkpoint guard.
// Git blob IDs are hashed, not file mtimes or documentation's own content,
// so the checkpoint can be committed atomically with the code it describes.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';

const args=process.argv.slice(2);
const mode=args[0];
const repoFlag=args.indexOf('--repo');
const repo=repoFlag>=0 ? path.resolve(args[repoFlag+1]) : process.cwd();
const worklog='docs/project-book/LIGHT_REMOTE_WORKLOG.md';
const codeMap='docs/project-book/LIGHT_REMOTE_CODE_MAP.md';
const checkpoint='.light-remote/CURRENT_CHECKPOINT.json';
const requiredPaths=[worklog,checkpoint];
const sourceRoots=[
  'api/','assets/','channels/','client/','deploy/','device-agent/',
  'gateway/','lib/','login/','operator-host/','platform-v2/',
  'plugin-server/','register/','settings/','support-gate/','usage/',
  '.githooks/','.github/workflows/'
];
const sourceFiles=new Set(['index.html','package.json','package-lock.json',
  'mcp.json','plugin.json','VERSION','CLIENT_COMPATIBILITY_FLOOR']);
const sourcePath=p=>sourceRoots.some(x=>p.startsWith(x))||sourceFiles.has(p);
const securityBoundary=p=>p.startsWith('operator-host/')||
  p.startsWith('plugin-server/')||p.startsWith('device-agent/')||
  p.startsWith('platform-v2/sql/')||
  /^lib\/(gold-|device-proof|native-terminal|gold-reconnect)/.test(p);
const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'buffer',maxBuffer:16*1024*1024});
const gitText=(...a)=>git(...a).toString('utf8');
const fail=message=>{throw new Error('PROJECT_TRUTH_DRIFT: '+message);};

function listSourceObjects(revision){
  // Index format: 100644 <blobOID> <stage> TAB path NUL
  // Commit tree: 100644 blob <blobOID> TAB path NUL
  const entries=revision===':'
    ?git('ls-files','--stage','-z')
    :git('ls-tree','-r','-z','--full-tree',revision);
  return entries.toString('utf8').split('\0').filter(Boolean).map(line=>{
    const n=line.indexOf('\t');
    if(n<0)fail('invalid_git_tree_line');
    const meta=line.slice(0,n).split(' ');
    const oid=revision===':'?meta[1]:meta[2];
    return {path:line.slice(n+1),oid,stage:revision===':'?meta[2]:null};
  }).filter(x=>sourcePath(x.path)&&(!x.stage||x.stage==='0')).sort((a,b)=>
    a.path<b.path?-1:a.path>b.path?1:0);
}
function digest(revision){
 const files=listSourceObjects(revision);
 const h=crypto.createHash('sha256');
 for(const f of files)h.update(f.path+'\0'+f.oid+'\n','utf8');
 return {algorithm:'sha256-git-blobs-v1',digest:h.digest('hex'),trackedFiles:files.length};
}
function changedPaths(mode,ref){
 const buff=mode==='staged'
   ?git('diff','--cached','--name-only','--diff-filter=ACDMRT','-z')
   :git('diff-tree','--no-commit-id','--name-only','--diff-filter=ACDMRT','-r','-z',ref);
 return buff.toString('utf8').split('\0').filter(Boolean);
}
function updatedWorklog(mode,ref){
 const a=mode==='staged'
   ?['diff','--cached','--unified=0','--',worklog]
   :['show','--format=','--unified=0',ref,'--',worklog];
 const diff=gitText(...a);
 return /^\+## 20\d\d-\d\d-\d\d\b/m.test(diff);
}
function readCheckpoint(mode,ref){
 const raw=mode==='staged'?gitText('show',':'+checkpoint):gitText('show',ref+':'+checkpoint);
 try{return JSON.parse(raw);}catch{fail('checkpoint must be valid JSON at '+ref);}
}
function verify(mode,ref){
 const paths=changedPaths(mode,ref),code=paths.filter(sourcePath);
 if(!code.length)return {ok:true,checked:'docs-only-or-no-code',ref};
 const missing=requiredPaths.filter(p=>!paths.includes(p));
 if(missing.length)fail('source changed but same commit/stage is missing: '+missing.join(', ')+'; source files: '+code.slice(0,6).join(', '));
 if(code.some(securityBoundary)&&!paths.includes(codeMap))fail('security/device/runtime source changed without Code Map update: '+codeMap);
 if(!updatedWorklog(mode,ref))fail('Worklog needs a NEW dated "## YYYY-MM-DD" milestone in the same commit');
 const cp=readCheckpoint(mode,ref);
 if(cp.schemaVersion!=='light-remote.current-checkpoint.v1')fail('checkpoint schema mismatch');
 if(!String(cp.nextAction||'').trim()||!String(cp.status||'').trim())fail('checkpoint status and nextAction required');
 const expect=digest(mode==='staged'?':':ref);
 if(cp.sourceSync?.algorithm!==expect.algorithm||
   cp.sourceSync?.treeDigest!==expect.digest||
   cp.sourceSync?.trackedFiles!==expect.trackedFiles)
   fail('checkpoint source SHA-256 does not match staged/committed source tree; run node deploy/scripts/check-project-truth-sync.mjs --stamp AFTER staging code');
 return {ok:true,checked:'code-docs-checkpoint-coherent',ref,changedCodeFiles:code.length,
   securityBoundaryChanged:code.some(securityBoundary),digest:expect.digest};
}
async function stamp(){
 const dest=path.join(repo,checkpoint);
 let cp;
 try{cp=JSON.parse(await fs.readFile(dest,'utf8'));}
 catch{fail('checkpoint file is missing or invalid JSON');}
 if(cp.schemaVersion!=='light-remote.current-checkpoint.v1')fail('unexpected checkpoint schema');
 cp.updatedDate=new Date().toISOString().slice(0,10);
 const staged=digest(':');
 cp.sourceSync={
   algorithm:staged.algorithm,
   treeDigest:staged.digest,
   trackedFiles:staged.trackedFiles,
   sourceOfTruth:'staged Git blob tree (excludes docs and checkpoint)',
   recordedAt:new Date().toISOString()
 };
 if(!String(cp.status||'').trim()||!String(cp.nextAction||'').trim())fail('write a meaningful status and nextAction before --stamp');
 await fs.writeFile(dest,JSON.stringify(cp,null,2)+'\n');
 git('add','--',checkpoint);
 return {ok:true,stamped:checkpoint,digest:cp.sourceSync.treeDigest,trackedSourceFiles:cp.sourceSync.trackedFiles};
}
try{
 let result;
 if(mode==='--stamp')result=await stamp();
 else if(mode==='--staged')result=verify('staged','INDEX');
 else if(mode==='--range'){
   const from=args[1],to=args[2];
   if(!from||!to||from.startsWith('--')||to.startsWith('--'))fail('--range requires base and tip SHA');
   const commits=gitText('rev-list','--reverse',from+'..'+to).trim().split('\n').filter(Boolean);
   result={ok:true,commitsChecked:commits.length,sourceCommits:0,details:[]};
   for(const commit of commits){
     const v=verify('commit',commit);
     if(v.checked==='code-docs-checkpoint-coherent')result.sourceCommits++;
     result.details.push({sha:commit.slice(0,12),checked:v.checked,changedCodeFiles:v.changedCodeFiles||0});
   }
 }else if(mode==='--head')result=verify('commit',gitText('rev-parse','HEAD').trim());
 else {console.error('Usage: node deploy/scripts/check-project-truth-sync.mjs --stamp|--staged|--head|--range BASE HEAD [--repo DIR]');process.exit(2);}
 console.log(JSON.stringify(result));
}catch(e){
 console.error(String(e.message||e));process.exit(1);
}
