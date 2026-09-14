import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executeNativeFs } from '../../lib/native-fs.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-native-fs-'));
const policy={readRoots:[root],writeRoots:[root]};
const call=input=>executeNativeFs(input,{policy});
const file=path.join(root,'a.txt'),copy=path.join(root,'copy.txt'),moved=path.join(root,'moved.txt');

let r=await call({op:'write',path:file,content:'one\ntwo\nthree\n',atomic:true});
if(!r.ok||r.writtenBytes!==14)throw new Error('write_failed');
r=await call({op:'read',path:file,startLine:2,maxLines:1});
if(r.text!=='two')throw new Error('line_read_failed');
r=await call({op:'read',path:file,tailLines:2});
if(!r.text.includes('three'))throw new Error('tail_read_failed');
r=await call({op:'edit',path:file,oldText:'two',newText:'TWO',expectedReplacements:1});
if(r.replacements!==1)throw new Error('edit_failed');
r=await call({op:'readMany',paths:[file,path.join(root,'missing.txt')],maxBytesPerFile:1024});
if(r.files.length!==2||!r.files[0].ok||r.files[1].ok!==false)throw new Error('read_many_failed');
await call({op:'mkdir',path:path.join(root,'nested','deep'),parents:true});
await call({op:'write',path:path.join(root,'nested','deep','b.txt'),content:'b'});
r=await call({op:'list',path:root,maxDepth:2,maxEntries:20});
if(!r.entries.some(x=>x.relativePath==='nested/deep/b.txt'))throw new Error('recursive_list_failed');
await call({op:'copy',source:file,destination:copy,overwrite:false});
let denied=false;try{await call({op:'copy',source:file,destination:copy,overwrite:false});}catch(e){denied=e.message==='filesystem_destination_exists';}
if(!denied)throw new Error('copy_overwrite_guard_failed');
await call({op:'move',source:copy,destination:moved,overwrite:false});
r=await call({op:'stat',path:moved});if(r.type!=='file')throw new Error('stat_failed');
await call({op:'delete',path:moved});
denied=false;try{await call({op:'read',path:'/etc/hosts'});}catch(e){denied=e.status===403;}
if(!denied)throw new Error('root_boundary_failed');
const final=await call({op:'read',path:file,maxLines:10});
if(!final.text.includes('TWO'))throw new Error('final_content_wrong');
fs.rmSync(root,{recursive:true,force:true});
console.log('v10-native-fs=PASS');
