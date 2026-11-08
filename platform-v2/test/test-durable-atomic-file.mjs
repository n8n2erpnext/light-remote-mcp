import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createDurableAtomicWriter} from '../../lib/durable-atomic-file.mjs';

function fixture(callback){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-atomic-registry-'));
 try{return callback(dir,path.join(dir,'state.json'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('01 atomic JSON replacement, fd+dir fsync and no .tmp remaining',()=>fixture((dir,file)=>{
 const synced=[];
 const writer=createDurableAtomicWriter({io:{...fs,fsyncSync(fd){
  const st=fs.fstatSync(fd);synced.push(st.isDirectory()?'directory':'file');
  return fs.fsyncSync(fd);
 }}});
 writer.write(file,'{"version":1}\n');
 writer.write(file,'{"version":2}\n');
 assert.equal(fs.readFileSync(file,'utf8'),'{"version":2}\n');
 assert.deepEqual(synced,['file','directory','file','directory']);
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.deepEqual(fs.readdirSync(dir),['state.json']);
}));
test('02 persistent file mode 0640 remains restricted',()=>fixture((dir,file)=>{
 createDurableAtomicWriter().write(file,'site',{mode:0o640});
 assert.equal(fs.statSync(file).mode&0o777,0o640);
}));
test('03 simulated file fsync failure leaves original content and latches',()=>fixture((dir,file)=>{
 fs.writeFileSync(file,'original',{mode:0o600});
 let attempts=0;
 const writer=createDurableAtomicWriter({io:{...fs,fsyncSync(){
  attempts++;throw Error('simulated_fsync_EIO');
 }}});
 assert.throws(()=>writer.write(file,'replacement'),/simulated_fsync_EIO/);
 assert.equal(fs.readFileSync(file,'utf8'),'original');
 assert.deepEqual(fs.readdirSync(dir),['state.json']);
 assert.throws(()=>writer.write(file,'second'),/simulated_fsync_EIO/);
 assert.equal(attempts,1);
}));
test('04 late directory fsync failure is never ACKed and permanently latches',()=>fixture((dir,file)=>{
 let calls=0;
 const writer=createDurableAtomicWriter({io:{...fs,fsyncSync(fd){
  calls++;if(calls===2)throw Error('simulated_dir_ENOSPC');
  return fs.fsyncSync(fd);
 }}});
 assert.throws(()=>writer.write(file,'payload'),/simulated_dir_ENOSPC/);
 assert.equal(writer.failed?.message,'simulated_dir_ENOSPC');
 assert.throws(()=>writer.write(file,'later'),/simulated_dir_ENOSPC/);
 assert.equal(calls,2);
}));
test('05 pre-existing symlink target cannot be replaced',()=>fixture((dir,file)=>{
 const elsewhere=path.join(dir,'elsewhere');fs.writeFileSync(elsewhere,'original');
 fs.symlinkSync(elsewhere,file);
 const writer=createDurableAtomicWriter();
 assert.throws(()=>writer.write(file,'untrusted'),/durable_state_untrusted_target/);
 assert.equal(fs.readFileSync(elsewhere,'utf8'),'original');
}));
test('06 no group writable parent, no hardlinked target',()=>fixture((dir,file)=>{
 fs.writeFileSync(file,'safe');
 fs.linkSync(file,path.join(dir,'alias'));
 const writer=createDurableAtomicWriter();
 assert.throws(()=>writer.write(file,'blocked'),/durable_state_untrusted_target/);
 fs.unlinkSync(path.join(dir,'alias'));
 fs.chmodSync(dir,0o777);
 assert.throws(()=>createDurableAtomicWriter().write(file,'blocked'),/durable_state_untrusted_directory/);
}));
test('07 rejects unsafe modes and nonabsolute paths without creating state',()=>fixture((dir,file)=>{
 assert.throws(()=>createDurableAtomicWriter().write(file,'data',{mode:0o666}),/invalid_path_or_mode/);
 assert.throws(()=>createDurableAtomicWriter().write('relative','x'),/invalid_path_or_mode/);
 assert.throws(()=>createDurableAtomicWriter().write(file,{}),/payload_invalid/);
 assert.equal(fs.existsSync(file),false);
}));
