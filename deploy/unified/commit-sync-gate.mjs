#!/usr/bin/env node
// Atomic code + project checkpoint + rolling handoff + docs gate.
// Source identity is derived from Git index/tree blobs, not wallclock files or stale worktrees.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const cpPath='MASTER_CHECKPOINT.json';
const handoffPath='PROJECT_HANDOFF.md';
const worklogPath='docs/project-book/LIGHT_REMOTE_WORKLOG.md';
const statusPath='docs/project-book/PROJECT_TRUTH_STATUS.json';
const codeMapPath='docs/project-book/LIGHT_REMOTE_CODE_MAP.md';
const contractMatrixPath='API_INTEGRATION_MATRIX.md';
const marker='light-remote.commit-sync.v1';
const REQUIRED=[cpPath,handoffPath,worklogPath,statusPath];
const control=new Set(REQUIRED);
const args=process.argv.slice(2);
const mode=args[0]||'--help';
const fail=(message)=>{
 console.error('\nCOMMIT_BLOCKED: '+message);
 console.error('YÊU CẦU BỔ SUNG CHECKPOINT + HANDOFF + DOCS (NẾU CÓ) VÀO CÙNG MỘT COMMIT.');
 console.error('Bắt buộc: MASTER_CHECKPOINT.json, PROJECT_HANDOFF.md, docs/project-book/LIGHT_REMOTE_WORKLOG.md, trạng thái docs; Code Map/API docs khi thay đổi phạm vi liên quan.');
 console.error('Không được commit code trước rồi ghi handoff/checkpoint ở commit sau. Không tạo nhánh mới để vượt qua gate.\n');
 process.exit(1);
};
const git=(argv,extraEnv={})=>{
 const p=spawnSync('git',argv,{cwd:root,encoding:'buffer',env:{...process.env,...extraEnv},maxBuffer:32*1024*1024});
 if(p.status!==0)throw new Error('git '+argv.join(' ')+' failed: '+String(p.stderr||'').trim().slice(0,350));
 return p.stdout;
};
const txt=(argv,env)=>git(argv,env).toString('utf8');
const optional=(argv)=>{
 try{return txt(argv);}catch{return null;}
};
const stagedList=()=>txt(['diff','--cached','--name-only','--diff-filter=ACDMRT','-z']).split('\0').filter(Boolean);
const commitList=(rev)=>txt(['diff-tree','--root','--no-commit-id','--name-only','--diff-filter=ACDMRT','-r','-z',rev]).split('\0').filter(Boolean);
const stagedContent=p=>txt(['show',':'+p]);
const treeContent=(rev,p)=>txt(['show',rev+':'+p]);
const parse=(str,loc)=>{
 try{return JSON.parse(str);}catch{fail('JSON không hợp lệ: '+loc);}
};
const isCodeBoundary=(p)=>{
 if(/\.(test|spec)\.[cm]?[jt]sx?$/.test(p)||p.endsWith('.test.rs'))return false;
 return /^(operator-host\/|plugin-server\/|device-agent\/|lib\/gold-|client\/desktop-v4\/src-tauri\/src\/|client\/windows-native\/|platform-v2\/sql\/)/.test(p)&&
  /\.(mjs|js|cjs|ts|tsx|rs|cs|sql|ps1|sh|csproj)$/.test(p);
};
const isContract=p=>p==='config/endpoints.json'||p==='contracts/api.v1.json';
const requiresBuildDoc=p=>/^(client\/windows-native\/installer\/|\.github\/workflows\/(windows-native-client|desktop-v4-native-ci)\.yml$)/.test(p)||
 p==='deploy/unified/build-manifest.mjs';
const requiredDocs=changed=>{
 const docs=[];
 if(changed.some(isCodeBoundary)||changed.some(isContract))docs.push(codeMapPath);
 if(changed.some(isContract))docs.push(contractMatrixPath);
 if(changed.some(requiresBuildDoc))docs.push('BUILD_AND_DEPLOYMENT.md');
 return docs;
};
const countedSources=entries=>{
 const selected=entries.filter(x=>!x.p.startsWith('docs/')&&!x.p.endsWith('.md')&&!control.has(x.p)&&x.p!=='MASTER_CHECKPOINT.json')
   .sort((a,b)=>a.p.localeCompare(b.p,'en'));
 const hash=crypto.createHash('sha256');
 for(const entry of selected)hash.update(entry.p+'\0'+entry.oid+'\n');
 return {algorithm:'sha256-git-blobs-v1',digest:hash.digest('hex'),count:selected.length};
};
const stagedSources=()=>{
 const out=txt(['ls-files','--stage','-z']);
 return countedSources(out.split('\0').filter(Boolean).map(x=>{
  const at=x.indexOf('\t');
  const meta=x.slice(0,at).split(' ');
  return {p:x.slice(at+1),oid:meta[1],stage:meta[2]};
 }).filter(x=>x.stage==='0'));
};
const treeSources=rev=>{
 const out=txt(['ls-tree','-r','-z','--full-tree',rev]);
 return countedSources(out.split('\0').filter(Boolean).map(x=>{
  const at=x.indexOf('\t');
  const meta=x.slice(0,at).split(' ');
  return {p:x.slice(at+1),oid:meta[2]};
 }));
};
const enforce=(changed,cp,previous,digest,addedHandoff,addedWorklog,stagedStatus)=>{
 const missing=REQUIRED.filter(x=>!changed.includes(x));
 if(missing.length)fail('Thiếu file staged trong CÙNG commit: '+missing.join(', '));
 const docsMissing=requiredDocs(changed).filter(p=>!changed.includes(p));
 if(docsMissing.length)fail('Thay đổi code/API/bảo mật/build nhưng thiếu docs/Code Map trong CÙNG commit: '+docsMissing.join(', '));
 const receipt=cp.commitSyncGate;
 if(!receipt||receipt.schemaVersion!==marker)
  fail('MASTER_CHECKPOINT.json thiếu commitSyncGate.schemaVersion='+marker);
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(receipt.taskId||''))
  fail('MASTER_CHECKPOINT.json cần commitSyncGate.taskId riêng biệt cho task/bước này (tối thiểu 8 ký tự).');
 if(previous?.commitSyncGate?.taskId===receipt.taskId)
  fail('Checkpoint chưa có taskId MỚI: hãy tạo receipt riêng cho mỗi commit/bước.');
 for(const key of ['status','summary','verification','nextAction'])
  if(typeof receipt[key]!=='string'||receipt[key].trim().length<8)
   fail('Checkpoint thiếu nội dung cụ thể tại commitSyncGate.'+key);
 if(receipt.sourceDigest!==digest.digest||receipt.sourceFileCount!==digest.count)
  fail('Checkpoint không khớp staged code: chạy node deploy/unified/commit-sync-gate.mjs --stamp sau khi git add, rồi stage lại catalog/handoff/docs.');
 const receiptTitle='## Task Receipt: '+receipt.taskId;
 if(!addedHandoff.split('\n').some(x=>x==='+ '+receiptTitle||x==='+'+receiptTitle))
  fail('PROJECT_HANDOFF.md chưa thêm mục mới "'+receiptTitle+'" trong CÙNG commit.');
 for(const expected of ['Status:','Source:','Verification:','Next:'])
  if(!addedHandoff.split('\n').some(x=>x.startsWith('+')&&x.includes(expected)))
   fail('PROJECT_HANDOFF.md thiếu dòng '+expected+' của task/bước này.');
 if(!addedWorklog.split('\n').some(x=>x.startsWith('+')&&x.includes('Receipt: '+receipt.taskId)))
  fail('Worklog chưa ghi Receipt: '+receipt.taskId+' trong CÙNG commit.');
 if(!stagedStatus||stagedStatus.checkpointUpdatedAt!==cp.updatedAt)
  fail('docs/project-book/PROJECT_TRUTH_STATUS.json chưa đồng bộ với MASTER_CHECKPOINT.json; chạy npm run docs:refresh rồi git add.');
 return receipt;
};
const added=(argv)=>txt(argv).split('\n').filter(x=>x.startsWith('+')&&!x.startsWith('+++')).join('\n');
const stagedPrevious=()=>{
 const raw=optional(['show','HEAD:'+cpPath]);
 return raw?parse(raw,'HEAD checkpoint'):null;
};
const staged=()=>{
 const changed=stagedList();
 if(!changed.length)fail('Không có staged changes; từ chối commit rỗng không có checkpoint/handoff.');
 const cp=parse(stagedContent(cpPath),'staged checkpoint');
 const status=parse(stagedContent(statusPath),'staged docs status');
 const receipt=enforce(changed,cp,stagedPrevious(),stagedSources(),
  added(['diff','--cached','--unified=0','--',handoffPath]),
  added(['diff','--cached','--unified=0','--',worklogPath]),status);
 console.log('ATOMIC_COMMIT_SYNC=PASS mode=staged task='+receipt.taskId+' files='+changed.length);
};
const stamp=()=>{
 const cp=parse(fs.readFileSync(path.join(root,cpPath),'utf8'),'working checkpoint');
 if(!cp.commitSyncGate||cp.commitSyncGate.schemaVersion!==marker||!cp.commitSyncGate.taskId)
  fail('Trước --stamp: điền commitSyncGate.taskId, status, summary, verification, nextAction trong MASTER_CHECKPOINT.json.');
 const digest=stagedSources();
 cp.commitSyncGate.sourceDigest=digest.digest;
 cp.commitSyncGate.sourceFileCount=digest.count;
 cp.updatedAt=new Date().toISOString();
 fs.writeFileSync(path.join(root,cpPath),JSON.stringify(cp,null,2)+'\n');
 git(['add','--',cpPath]);
 console.log('ATOMIC_CHECKPOINT_STAMPED='+cp.commitSyncGate.taskId+' sourceDigest='+digest.digest+' tracked='+digest.count);
 console.log('NEXT: npm run docs:refresh && git add MASTER_CHECKPOINT.json PROJECT_HANDOFF.md docs/project-book/ && node deploy/unified/commit-sync-gate.mjs --staged');
};
const range=(base,head)=>{
 if(!base||!head)fail('Cần --range <base> <head> để xác minh từng commit trên CI.');
 const commits=txt(['rev-list','--reverse',base+'..'+head]).trim().split('\n').filter(Boolean);
 let enforced=0,legacy=0;
 let activated=!!parse(treeContent(base,cpPath),'base checkpoint').commitSyncGate?.schemaVersion;
 for(const rev of commits){
  const cp=parse(treeContent(rev,cpPath),rev+' checkpoint');
  const inCommit=cp.commitSyncGate?.schemaVersion===marker;
  if(!activated&&!inCommit){legacy++;continue;}
  if(activated&&!inCommit)fail('Commit '+rev.slice(0,12)+' đã xóa gate/checkpoint bắt buộc.');
  activated=true;
  const prior=optional(['show',rev+'^:'+cpPath]);
  const changed=commitList(rev);
  const status=parse(treeContent(rev,statusPath),rev+' docs status');
  const receipt=enforce(changed,cp,prior?parse(prior,rev+'^ checkpoint'):null,treeSources(rev),
   added(['show','--format=','--unified=0',rev,'--',handoffPath]),
   added(['show','--format=','--unified=0',rev,'--',worklogPath]),status);
  console.log('ATOMIC_COMMIT_SYNC=PASS commit='+rev.slice(0,12)+' task='+receipt.taskId);
  enforced++;
 }
 console.log('ATOMIC_COMMIT_RANGE=PASS commits_checked='+enforced+' historical_pre_activation='+legacy);
};
try{
 if(mode==='--staged')staged();
 else if(mode==='--stamp')stamp();
 else if(mode==='--range')range(args[1],args[2]);
 else {
  console.log('Usage: node deploy/unified/commit-sync-gate.mjs --staged | --stamp | --range <base> <head>');
  process.exit(mode==='--help'?0:2);
 }
}catch(e){fail(e.message||String(e));}
