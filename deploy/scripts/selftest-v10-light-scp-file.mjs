import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { LightScpFileRegistry } from '../../lib/light-scp-file.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-scp-'));
const policy={readRoots:[root],writeRoots:[root],uploadRoots:[root],downloadRoots:[root]};
const reg=new LightScpFileRegistry({policy,ttlMs:30000,maxTransferBytes:2*1024*1024,defaultChunkBytes:65536,maxChunkBytes:131072});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const content=Buffer.alloc(150321);for(let i=0;i<content.length;i++)content[i]=i%251;
const dest=path.join(root,'uploaded.bin');
const up=await reg.beginUpload({destination:dest,totalBytes:content.length,chunkBytes:65536,sha256:hash(content)});
assert.equal(up.totalChunks,3);assert.equal(up.complete,false);
async function put(index){const start=index*up.chunkBytes,end=Math.min(content.length,start+up.chunkBytes),chunk=content.subarray(start,end);return reg.putUploadChunk(up.id,{index,data:chunk.toString('base64url'),sha256:hash(chunk)});}
await put(1);await put(0);await put(1);await put(2);
let status=await reg.status(up.id);assert.equal(status.complete,true);assert.equal(status.progressBytes,content.length);
const committed=await reg.commitUpload(up.id);assert.equal(committed.sha256,hash(content));
assert.deepEqual(await fsp.readFile(dest),content);
let denied=false;try{await reg.beginUpload({destination:dest,totalBytes:1,sha256:hash(Buffer.from('x'))});}catch(e){denied=e.message==='scp_destination_exists';}
assert.ok(denied,'overwrite_must_be_explicit');
const replacement=Buffer.from('replacement-data');
const up2=await reg.beginUpload({destination:dest,totalBytes:replacement.length,sha256:hash(replacement),overwrite:true});
await reg.putUploadChunk(up2.id,{index:0,data:replacement.toString('base64url'),sha256:hash(replacement)});
await reg.commitUpload(up2.id);assert.deepEqual(await fsp.readFile(dest),replacement);
const racePath=path.join(root,'race.bin'),raceData=Buffer.from('race-source');
const race=await reg.beginUpload({destination:racePath,totalBytes:raceData.length,sha256:hash(raceData)});
await reg.putUploadChunk(race.id,{index:0,data:raceData.toString('base64url'),sha256:hash(raceData)});await fsp.writeFile(racePath,'other');
let raceDenied=false;try{await reg.commitUpload(race.id);}catch(e){raceDenied=e.message==='scp_destination_exists';}
assert.ok(raceDenied,'destination_race_must_fail');await reg.cancel(race.id);
console.log('v10-light-scp-upload-resume-integrity=PASS');
console.log('v10-light-scp-upload-overwrite-race=PASS');
const source=path.join(root,'download.bin');await fsp.writeFile(source,content);
const down=await reg.beginDownload({source,chunkBytes:65536});assert.equal(down.sha256,hash(content));
const received=new Map();for(const index of [2,0,1,1]){const part=await reg.readDownloadChunk(down.id,{index});const data=Buffer.from(part.data,'base64url');assert.equal(hash(data),part.sha256);received.set(index,data);}
status=await reg.status(down.id);assert.equal(status.complete,true);assert.equal(status.progressBytes,content.length);
const rebuilt=Buffer.concat([...received.entries()].sort((a,b)=>a[0]-b[0]).map(([,v])=>v));assert.deepEqual(rebuilt,content);
const changing=path.join(root,'changing.bin');await fsp.writeFile(changing,content);
const down2=await reg.beginDownload({source:changing,chunkBytes:65536});
await new Promise(resolve=>setTimeout(resolve,5));await fsp.writeFile(changing,Buffer.from(content.map(v=>(v+1)%251)));
let changed=false;try{await reg.readDownloadChunk(down2.id,{index:0});}catch(e){changed=e.message==='scp_download_source_changed';}
assert.ok(changed,'download_source_change_must_fail');await reg.cancel(down2.id);
await fsp.rm(root,{recursive:true,force:true});
console.log('v10-light-scp-download-resume-integrity=PASS');
console.log('v10-light-scp-download-source-change=PASS');
