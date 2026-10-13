import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {SyntheticReplayJournal,initializeSyntheticReplayJournal}
 from '../portability/synthetic-durable-nonce-journal.mjs';

const a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32);
function fixture(fn){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-nonce-unit-'));
 fs.chmodSync(folder,0o700);
 const file=path.join(folder,'nonce.log');
 initializeSyntheticReplayJournal(file);
 try{return fn(folder,file);}
 finally{fs.rmSync(folder,{recursive:true,force:true});}
}
test('durable nonce survives close and reopen; all prior nonces denied',()=>fixture((dir,file)=>{
 let journal=new SyntheticReplayJournal(file,{limit:3});
 assert.equal(journal.claim(a),200);
 assert.equal(journal.claim(a),409);
 assert.equal(journal.claim(b),200);
 journal.close();
 journal=new SyntheticReplayJournal(file,{limit:3});
 assert.equal(journal.claim(a),409);
 assert.equal(journal.claim(b),409);
 assert.equal(journal.claim(c),200);
 assert.equal(journal.claim('d'.repeat(32)),503);
 journal.close();
 assert.match(fs.readFileSync(file,'utf8'),/^LR_RC50_UAT_REPLAY_V1\n/);
}));
test('fresh Node process also refuses the same recorded nonce',()=>fixture((dir,file)=>{
 const journal=new SyntheticReplayJournal(file);
 assert.equal(journal.claim(a),200);journal.close();
 const source=`import {SyntheticReplayJournal} from ${JSON.stringify(
  new URL('../portability/synthetic-durable-nonce-journal.mjs',import.meta.url).href)};
const journal=new SyntheticReplayJournal(process.argv[1]);
process.exit(journal.claim('${a}')===409?0:12);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',source,file],
   {encoding:'utf8',timeout:3500});
 assert.equal(result.status,0,result.stderr||'replay_refused');
}));
test('nonce format rejected without consuming journal capacity',()=>fixture((dir,file)=>{
 const journal=new SyntheticReplayJournal(file,{limit:1});
 assert.equal(journal.claim('../a'),401);
 assert.equal(journal.claim(a.toUpperCase()),401);
 assert.equal(journal.claim(a),200);
 journal.close();
}));
test('truncated or tampered journal refuses startup, no silent repair',()=>fixture((dir,file)=>{
 const journal=new SyntheticReplayJournal(file);journal.claim(a);journal.close();
 fs.appendFileSync(file,'garbage');
 const before=fs.readFileSync(file);
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_JOURNAL_NOT_READY/);
 assert.deepEqual(fs.readFileSync(file),before);
}));
test('symlink, insecure owner directory and file permissions refused',()=>fixture((dir,file)=>{
 const elsewhere=path.join(dir,'elsewhere');
 fs.writeFileSync(elsewhere,'unsafe',{mode:0o600});
 fs.rmSync(file);
 fs.symlinkSync(elsewhere,file);
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_JOURNAL_NOT_READY/);
 fs.rmSync(file);
 fs.chmodSync(dir,0o755);
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_DIR_UNTRUSTED/);
 fs.chmodSync(dir,0o700);
 fs.writeFileSync(file,'LR_RC50_UAT_REPLAY_V1\n',{mode:0o600});
 fs.chmodSync(file,0o644);
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_JOURNAL_NOT_READY/);
}));
test('missing journal or missing parent fails closed; bad limits refused',()=>fixture((dir,file)=>{
 assert.throws(()=>new SyntheticReplayJournal(path.join(dir,'missing','nonce.log')));
 fs.rmSync(file);
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_JOURNAL_NOT_READY/);
 assert.throws(()=>new SyntheticReplayJournal(file,{limit:0}),/REPLAY_LIMIT_INVALID/);
 assert.throws(()=>new SyntheticReplayJournal(file,{limit:1025}),/REPLAY_LIMIT_INVALID/);
 initializeSyntheticReplayJournal(file);
 assert.throws(()=>initializeSyntheticReplayJournal(file),/EEXIST/);
}));
test('duplicate record / invalid magic are fail-closed',()=>fixture((dir,file)=>{
 fs.writeFileSync(file,'LR_RC50_UAT_REPLAY_V1\n'+a+'\n'+a+'\n',{mode:0o600});
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_JOURNAL_NOT_READY/);
 fs.writeFileSync(file,'INVALID\n'+a+'\n');
 assert.throws(()=>new SyntheticReplayJournal(file),/REPLAY_JOURNAL_NOT_READY/);
}));
