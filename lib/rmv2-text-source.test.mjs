import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {readLogicalTextSource} from './rmv2-text-source.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('pinned UTF8 reference reads complete text only within Owner roots',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rm-text-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const inside=path.join(root,'allowed');await fs.mkdir(inside);const file=path.join(inside,'text.txt'),outside=path.join(root,'outside.txt');
 const data=Buffer.from('Vietnamese: \u0110\u00e2y l\u00e0 '+String.fromCodePoint(0x1f600)+'\r\n'.repeat(16000));await fs.writeFile(file,data);await fs.writeFile(outside,data);
 const policy={readRoots:[inside],downloadRoots:[root]};
 assert.equal(await readLogicalTextSource(file,hash(data),policy),data.toString('utf8'));
 await assert.rejects(readLogicalTextSource(outside,hash(data),policy),/outside_allowed_roots/);
 await assert.rejects(readLogicalTextSource(file,'0'.repeat(64),policy),/digest_mismatch/);
 await assert.rejects(readLogicalTextSource(file,'missing',policy),/sha256_required/);
 await assert.rejects(readLogicalTextSource(inside,hash(data),policy),/file_budget/);
});
test('invalid UTF8/NUL and symlink escapes never become typing input',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'rm-text-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const allowed=path.join(root,'allowed');await fs.mkdir(allowed);const file=path.join(allowed,'bad');
 for(const data of [Buffer.from([0xff,0xfe,0xfa]),Buffer.from('text\0secret')]){await fs.writeFile(file,data);await assert.rejects(readLogicalTextSource(file,hash(data),{readRoots:[allowed]}));}
 const other=path.join(root,'secret');const data=Buffer.from('outside');await fs.writeFile(other,data);
 try{await fs.symlink(other,path.join(allowed,'link'));}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.diagnostic('symlink creation unavailable on this host; Linux CI must execute escape case');return;}throw error;}
 await assert.rejects(readLogicalTextSource(path.join(allowed,'link'),hash(data),{readRoots:[allowed]}),/outside_allowed_roots/);
});
