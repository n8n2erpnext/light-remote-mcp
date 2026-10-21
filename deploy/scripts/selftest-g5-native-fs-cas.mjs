import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeNativeFs} from '../../lib/native-fs.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'g5-edit-cas-'));
const file=path.join(root,'shared.txt'),policy={readRoots:[root],writeRoots:[root]};
const run=op=>executeNativeFs(op,{policy});
try{
 await run({op:'write',path:file,content:'header\ninitial\n'});
 const original=await run({op:'read',path:file});
 assert.match(original.sha256,/^[a-f0-9]{64}$/);
 await fs.writeFile(file,'header\nchanged by another writer\n');
 await assert.rejects(()=>run({op:'edit',path:file,oldText:'header',newText:'HEADER',
   expectedReplacements:1,expectedSha256:original.sha256}),e=>e.status===409&&e.message==='filesystem_edit_conflict');
 assert.equal(await fs.readFile(file,'utf8'),'header\nchanged by another writer\n');
 console.log('G5_STALE_EXPECTED_SHA_REJECTED_WITHOUT_OVERWRITE=PASS');

 const latest=await run({op:'read',path:file});
 const patched=await run({op:'edit',path:file,oldText:'header',newText:'HEADER',
  expectedReplacements:1,expectedSha256:latest.sha256});
 assert.equal(patched.replacements,1);
 assert.equal(await fs.readFile(file,'utf8'),'HEADER\nchanged by another writer\n');
 console.log('G5_FRESH_EXPECTED_SHA_EDIT_SUCCEEDS=PASS');
 await assert.rejects(()=>run({op:'edit',path:file,oldText:'HEADER',newText:'header',
   expectedSha256:'malformed'}),e=>e.status===400&&e.message==='filesystem_edit_expected_sha256_invalid');
 assert.equal((await fs.readdir(root)).length,1,'orphan temporary edit artifacts');
 console.log('G5_INVALID_SHA_AND_TEMP_FILE_CLEANUP=PASS');
}finally{await fs.rm(root,{recursive:true,force:true})}
