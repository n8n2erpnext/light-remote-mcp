import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import {resolveDownloadSource} from './native-fs.mjs';
import {RM_TEXT_REFERENCE_BYTES} from './rmv2-text-write.mjs';

// Pinned, device-local UTF-8 content. Use existing Owner read roots rather than
// accepting a cloud path or widening policy to all paths available to Node.
export async function readLogicalTextSource(sourcePath,sourceSha256,policy){
  if(typeof sourceSha256!=='string'||!/^[a-f0-9]{64}$/.test(sourceSha256))throw Error('desktop_text_source_sha256_required');
  const constrained={...policy,downloadRoots:policy.readRoots};
  const real=await resolveDownloadSource(sourcePath,constrained);
  const file=await fsp.open(real,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const before=await file.stat();
    if(!before.isFile()||before.size<1||before.size>RM_TEXT_REFERENCE_BYTES)throw Error('desktop_text_source_file_budget');
    const checked=await resolveDownloadSource(real,constrained),pathStat=await fsp.stat(checked);
    if(pathStat.dev!==before.dev||pathStat.ino!==before.ino)throw Error('desktop_text_source_identity_changed');
    const parts=[];let bytes=0;
    for(;;){
      const packet=Buffer.alloc(Math.min(1024*1024,RM_TEXT_REFERENCE_BYTES+1-bytes));
      const {bytesRead}=await file.read(packet,0,packet.length,null);if(!bytesRead)break;
      bytes+=bytesRead;if(bytes>RM_TEXT_REFERENCE_BYTES)throw Error('desktop_text_source_file_budget');
      parts.push(packet.subarray(0,bytesRead));
    }
    const after=await file.stat();
    if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('desktop_text_source_changed');
    const data=Buffer.concat(parts);
    if(crypto.createHash('sha256').update(data).digest('hex')!==sourceSha256)throw Error('desktop_text_source_digest_mismatch');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
    if(!text.length||text.includes('\0'))throw Error('desktop_text_source_not_utf8_text');
    return text;
  }finally{await file.close();}
}
