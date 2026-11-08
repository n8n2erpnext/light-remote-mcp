import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'check-project-truth-sync.mjs');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'light-remote-truth-guard-'));
const run=(exe,args,allowFailure=false)=>{
 const r=spawnSync(exe,args,{cwd:temp,encoding:'utf8'});
 if(!allowFailure&&r.status!==0)throw new Error(exe+' '+args.join(' ')+' : '+r.stderr+' '+r.stdout);
 return r;
};
const git=(...args)=>run('git',args).stdout.trim();
const write=async(p,text)=>{
 await fs.mkdir(path.dirname(path.join(temp,p)),{recursive:true});
 await fs.writeFile(path.join(temp,p),text);
};
const guard=(args,success)=>{
 const r=run(process.execPath,[script,...args,'--repo',temp],true);
 assert.equal(r.status===0,success,'Unexpected guard result: '+r.stderr+' '+r.stdout);
 return r;
};
try{
 git('init','-q');git('config','user.name','Gold CI Test');git('config','user.email','gold-ci@example.test');
 await write('deploy/main.mjs','export const value = 1;\n');
 await write('operator-host/executor.mjs','export const owner = true;\n');
 await write('docs/project-book/LIGHT_REMOTE_WORKLOG.md','# Worklog\n');
 await write('docs/project-book/LIGHT_REMOTE_CODE_MAP.md','# Code map\n');
 await write('.light-remote/CURRENT_CHECKPOINT.json',JSON.stringify({
  schemaVersion:'light-remote.current-checkpoint.v1',status:'initial test',
  nextAction:'continue isolated test'},null,2));
 git('add','.');git('commit','-qm','baseline');
 const before=git('rev-parse','HEAD');

 await write('deploy/main.mjs','export const value = 2;\n');git('add','deploy/main.mjs');
 guard(['--staged'],false); // code-only commit must fail
 await fs.appendFile(path.join(temp,'docs/project-book/LIGHT_REMOTE_WORKLOG.md'),
  '\n## 2026-10-30 — Source guard fixture\nChanged the synthetic code.\n');
 git('add','docs/project-book/LIGHT_REMOTE_WORKLOG.md');
 guard(['--staged'],false); // still missing updated checkpoint
 const checkpoint='.light-remote/CURRENT_CHECKPOINT.json';
 const original=JSON.parse(await fs.readFile(path.join(temp,checkpoint),'utf8'));
 original.status='fixture code changed';
 await write(checkpoint,JSON.stringify(original,null,2)+'\n');
 git('add',checkpoint);
 guard(['--staged'],false); // file touched, but SHA not updated
 guard(['--stamp'],true);
 guard(['--staged'],true);
 git('commit','-qm','update code with synced docs');
 const first=git('rev-parse','HEAD');
 guard(['--range',before,first],true);

 // Any code change after stamping must invalidate the checkpoint digest.
 await write('deploy/main.mjs','export const value = 3;\n');git('add','deploy/main.mjs');
 await fs.appendFile(path.join(temp,'docs/project-book/LIGHT_REMOTE_WORKLOG.md'),
  '\n## 2026-10-30 — Source code moved again\nBefore re-stamping.\n');
 git('add','docs/project-book/LIGHT_REMOTE_WORKLOG.md');
 guard(['--stamp'],true);
 await write('deploy/main.mjs','export const value = 4;\n');
 git('add','deploy/main.mjs');
 guard(['--staged'],false); // digest mismatch despite Worklog/checkpoint changes
 guard(['--stamp'],true);
 guard(['--staged'],true);
 git('commit','-qm','restamped source');

 // Trust-critical source requires a Code Map change in addition to both others.
 const second=git('rev-parse','HEAD');
 await write('operator-host/executor.mjs','export const owner = false;\n');
 git('add','operator-host/executor.mjs');
 await fs.appendFile(path.join(temp,'docs/project-book/LIGHT_REMOTE_WORKLOG.md'),
  '\n## 2026-10-30 — Operator changed\nUpdated authority map.\n');
 git('add','docs/project-book/LIGHT_REMOTE_WORKLOG.md');
 guard(['--stamp'],true);
 guard(['--staged'],false); // missing Code Map update
 await fs.appendFile(path.join(temp,'docs/project-book/LIGHT_REMOTE_CODE_MAP.md'),
  '\nOperator scope: synthetic test.\n');
 git('add','docs/project-book/LIGHT_REMOTE_CODE_MAP.md');
 guard(['--staged'],true);
 git('commit','-qm','operator change includes map');
 guard(['--range',second,git('rev-parse','HEAD')],true);

 // A later docs-only commit doesn't require a new source fingerprint.
 await fs.appendFile(path.join(temp,'docs/project-book/LIGHT_REMOTE_WORKLOG.md'),
  '\n## 2026-10-30 — Docs-only\nNo source changes.\n');
 git('add','docs/project-book/LIGHT_REMOTE_WORKLOG.md');
 guard(['--staged'],true);
 console.log('GOLD_SOURCE_DOCS_CHECKPOINT_DRIFT_GATE_SELFTEST=PASS');
 console.log('CODE_ONLY_DENIED=PASS');
 console.log('WORKLOG_ONLY_DENIED=PASS');
 console.log('STALE_SOURCE_SHA_DENIED=PASS');
 console.log('TRUST_BOUNDARY_REQUIRES_CODE_MAP=PASS');
 console.log('SAME_COMMIT_DOCS_AND_SHA_ACCEPTED=PASS');
 console.log('SOURCE_RANGE_AND_DOCS_ONLY_ACCEPTED=PASS');
}finally{await fs.rm(temp,{recursive:true,force:true});}
