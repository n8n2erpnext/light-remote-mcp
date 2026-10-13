import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {appendDurableAuditBatch} from '../../operator-host/durable-audit-append.mjs';
import {AuditAppendBarrier} from '../../operator-host/audit-append-barrier.mjs';

async function tmp(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-audit-durable-'));
 try{return await fn(dir,path.join(dir,'operations.jsonl'));}
 finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('01 real fsync append preserves ordered JSONL and restrictive mode',()=>tmp(async(dir,file)=>{
 await appendDurableAuditBatch(file,'{"id":1}\n');
 await appendDurableAuditBatch(file,'{"id":2}\n');
 assert.equal(fs.readFileSync(file,'utf8'),'{"id":1}\n{"id":2}\n');
 assert.equal(fs.statSync(file).mode&0o077,0);
}));
test('02 file sync and directory sync both happen before completion',()=>tmp(async(dir,file)=>{
 const calls=[];
 await appendDurableAuditBatch(file,'one\n',{
  openFile:async(...args)=>{
   const handle=await fs.promises.open(...args);
   return {stat:()=>handle.stat(),writeFile:async x=>{calls.push('write');return handle.writeFile(x);},
    sync:async()=>{calls.push('file-sync');await handle.sync();},
    close:()=>handle.close()};
  },
  openDirectory:async(...args)=>{
   const handle=await fs.promises.open(...args);
   return {sync:async()=>{calls.push('dir-sync');await handle.sync();},
    close:()=>handle.close()};
  }
 });
 assert.deepEqual(calls,['write','file-sync','dir-sync']);
}));
test('03 file fsync fault rejects and permanently latches append barrier',()=>tmp(async(dir,file)=>{
 let calls=0;
 const write=batch=>appendDurableAuditBatch(file,batch,{
  openFile:async(...args)=>{
   calls++;
   const h=await fs.promises.open(...args);
   return {stat:()=>h.stat(),writeFile:x=>h.writeFile(x),
    sync:async()=>{throw Error('simulated_file_EIO');},close:()=>h.close()};
  }
 });
 const b=new AuditAppendBarrier({write});
 await assert.rejects(b.enqueue('first\n'),/simulated_file_EIO/);
 await assert.rejects(b.flush(),/simulated_file_EIO/);
 await assert.rejects(b.enqueue('second\n'),/simulated_file_EIO/);
 assert.equal(calls,1);
}));
test('04 directory fsync fault cannot acknowledge an audit checkpoint',()=>tmp(async(dir,file)=>{
 const write=batch=>appendDurableAuditBatch(file,batch,{
  openDirectory:async(...args)=>{
   const h=await fs.promises.open(...args);
   return {sync:async()=>{throw Error('simulated_dir_ENOSPC');},
    close:()=>h.close()};
  }
 });
 const b=new AuditAppendBarrier({write});
 await assert.rejects(b.enqueue('first\n'),/simulated_dir_ENOSPC/);
 await assert.rejects(b.flush(),/simulated_dir_ENOSPC/);
}));
test('05 symlinked audit output denied before append',()=>tmp(async(dir,file)=>{
 const target=path.join(dir,'target');
 fs.writeFileSync(target,'safe\n');
 fs.symlinkSync(target,file);
 await assert.rejects(appendDurableAuditBatch(file,'payload\n'));
 assert.equal(fs.readFileSync(target,'utf8'),'safe\n');
}));
test('06 nonexistent audit directory fails closed; does not auto-fallback',()=>tmp(async(dir,file)=>{
 await assert.rejects(appendDurableAuditBatch(path.join(dir,'missing','audit'),'a\n'));
 assert.equal(fs.existsSync(path.join(dir,'missing')),false);
}));
test('07 invalid payload/path rejected and directory-only success not possible',()=>tmp(async(dir,file)=>{
 await assert.rejects(appendDurableAuditBatch('relative','x'),/invalid_input/);
 await assert.rejects(appendDurableAuditBatch(file,''),/invalid_input/);
 await assert.rejects(appendDurableAuditBatch(file,{}),/invalid_input/);
 await assert.rejects(appendDurableAuditBatch(dir,'x'),/not_regular_file|EISDIR/);
}));
