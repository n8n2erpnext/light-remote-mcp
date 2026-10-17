import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { filesystemPolicy, resolveUploadTarget, resolveDownloadSource } from './native-fs.mjs';

export class LightScpFileError extends Error {
  constructor(message,status=400){super(message);this.name='LightScpFileError';this.status=status;}
}
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
const validHash=value=>{const v=String(value||'').trim().toLowerCase();if(!/^[0-9a-f]{64}$/.test(v))throw new LightScpFileError('scp_invalid_sha256');return v;};
const validId=value=>{const v=String(value||'').trim();if(!/^lscp_[A-Za-z0-9_-]{20,80}$/.test(v))throw new LightScpFileError('scp_invalid_transfer_id');return v;};
function decodeChunk(value){
  const raw=String(value||'').trim();
  if(!raw||!/^[A-Za-z0-9_-]+$/.test(raw)||raw.length%4===1)throw new LightScpFileError('scp_invalid_chunk_encoding');
  const data=Buffer.from(raw,'base64url');
  if(data.toString('base64url')!==raw)throw new LightScpFileError('scp_invalid_chunk_encoding');
  return data;
}
async function hashFile(file){
  return new Promise((resolve,reject)=>{
    const hash=crypto.createHash('sha256'),stream=fs.createReadStream(file);
    stream.on('data',chunk=>hash.update(chunk));stream.on('error',reject);stream.on('end',()=>resolve(hash.digest('hex')));
  });
}
export class LightScpFileRegistry {
  constructor(options={}){
    this.ttlMs=Math.max(30000,Number(options.ttlMs)||600000);
    this.maxTransferBytes=Math.max(1024,Number(options.maxTransferBytes)||2147483648);
    this.defaultChunkBytes=Math.max(65536,Number(options.defaultChunkBytes)||1048576);
    this.maxChunkBytes=Math.max(this.defaultChunkBytes,Number(options.maxChunkBytes)||4194304);
    this.maxActive=Math.max(1,Number(options.maxActive)||64);
    this.policy=options.policy||filesystemPolicy();
    this.transfers=new Map();
  }
  async cleanup(now=Date.now()){
    for(const [id,row] of this.transfers){
      if(row.expiresAt>now)continue;
      if(row.mode==='upload'&&row.tempPath)await fsp.rm(row.tempPath,{force:true}).catch(()=>{});
      this.transfers.delete(id);
    }
  }
  async _get(id,touch=true){
    await this.cleanup();
    id=validId(id);
    const row=this.transfers.get(id);
    if(!row)throw new LightScpFileError('scp_transfer_not_found',404);
    if(touch){row.lastSeenAt=Date.now();row.expiresAt=row.lastSeenAt+this.ttlMs;}
    return row;
  }
  _view(row){
    const upload=row.mode==='upload',chunks=upload?(row.received?.size||0):(row.sent?.size||0);
    const bytes=upload?(row.receivedBytes||0):(row.sentBytes||0),done=chunks===row.totalChunks&&bytes===row.totalBytes;
    return {id:row.id,mode:row.mode,totalBytes:row.totalBytes,chunkBytes:row.chunkBytes,totalChunks:row.totalChunks,sha256:row.sha256,progressChunks:chunks,progressBytes:bytes,receivedChunks:upload?chunks:undefined,receivedBytes:upload?bytes:undefined,sentChunks:upload?undefined:chunks,sentBytes:upload?undefined:bytes,overwrite:Boolean(row.overwrite),createdAt:row.createdAt,lastSeenAt:row.lastSeenAt,expiresAt:row.expiresAt,complete:done};
  }
  async status(id){return this._view(await this._get(id));}
  async beginUpload(input={}){
    await this.cleanup();
    if(this.transfers.size>=this.maxActive)throw new LightScpFileError('scp_transfer_limit',503);
    const totalBytes=Number(input.totalBytes);
    if(!Number.isSafeInteger(totalBytes)||totalBytes<1||totalBytes>this.maxTransferBytes)throw new LightScpFileError('scp_invalid_transfer_size',413);
    const chunkBytes=Math.max(65536,Math.min(Number(input.chunkBytes)||this.defaultChunkBytes,this.maxChunkBytes));
    const totalChunks=Math.ceil(totalBytes/chunkBytes),hash=validHash(input.sha256);
    let destination=await resolveUploadTarget(input.destination,this.policy);
    const parent=path.dirname(destination);
    if(input.createParents)await fsp.mkdir(parent,{recursive:true});
    const parentStat=await fsp.stat(parent).catch(()=>null);
    if(!parentStat?.isDirectory())throw new LightScpFileError('scp_parent_not_found',404);
    destination=await resolveUploadTarget(destination,this.policy);
    const existing=await fsp.lstat(destination).catch(()=>null),overwrite=Boolean(input.overwrite);
    if(existing?.isDirectory())throw new LightScpFileError('scp_destination_is_directory',409);
    if(existing&&!overwrite)throw new LightScpFileError('scp_destination_exists',409);
    const id=`lscp_${crypto.randomBytes(18).toString('base64url')}`;
    const tempPath=path.join(parent,`.lr-scp-${id}.part`);
    const fh=await fsp.open(tempPath,'wx');await fh.close();
    const now=Date.now();
    const row={id,mode:'upload',destination,tempPath,totalBytes,chunkBytes,totalChunks,sha256:hash,overwrite,received:new Map(),receivedBytes:0,createdAt:now,lastSeenAt:now,expiresAt:now+this.ttlMs};
    this.transfers.set(id,row);
    return this._view(row);
  }
  async putUploadChunk(id,input={}){
    const row=await this._get(id);
    if(row.mode!=='upload')throw new LightScpFileError('scp_transfer_mode_mismatch',409);
    const index=Number(input.index);
    if(!Number.isSafeInteger(index)||index<0||index>=row.totalChunks)throw new LightScpFileError('scp_invalid_chunk_index');
    const data=decodeChunk(input.data),hash=validHash(input.sha256);
    const expectedBytes=index===row.totalChunks-1?row.totalBytes-index*row.chunkBytes:row.chunkBytes;
    if(data.length!==expectedBytes)throw new LightScpFileError('scp_chunk_size_mismatch',409);
    if(sha256(data)!==hash)throw new LightScpFileError('scp_chunk_hash_mismatch',409);
    const prior=row.received.get(index);
    if(prior){
      if(prior.sha256!==hash||prior.bytes!==data.length)throw new LightScpFileError('scp_chunk_conflict',409);
      return this._view(row);
    }
    const fh=await fsp.open(row.tempPath,'r+');
    try{await fh.write(data,0,data.length,index*row.chunkBytes);}finally{await fh.close();}
    row.received.set(index,{sha256:hash,bytes:data.length});row.receivedBytes+=data.length;
    row.lastSeenAt=Date.now();row.expiresAt=row.lastSeenAt+this.ttlMs;
    return this._view(row);
  }
  async commitUpload(id){
    const row=await this._get(id);
    if(row.mode!=='upload')throw new LightScpFileError('scp_transfer_mode_mismatch',409);
    if(row.received.size!==row.totalChunks||row.receivedBytes!==row.totalBytes)throw new LightScpFileError('scp_upload_incomplete',409);
    const st=await fsp.stat(row.tempPath).catch(()=>null);
    if(!st?.isFile()||st.size!==row.totalBytes)throw new LightScpFileError('scp_upload_size_mismatch',409);
    const actualHash=await hashFile(row.tempPath);
    if(actualHash!==row.sha256)throw new LightScpFileError('scp_upload_hash_mismatch',409);
    const existing=await fsp.lstat(row.destination).catch(()=>null);
    if(existing?.isDirectory())throw new LightScpFileError('scp_destination_is_directory',409);
    if(existing&&!row.overwrite)throw new LightScpFileError('scp_destination_exists',409);
    try{await fsp.rename(row.tempPath,row.destination);}
    catch(error){
      if(!row.overwrite)throw error;
      throw new LightScpFileError(`scp_atomic_replace_failed:${error?.code||'rename'}`,409);
    }
    this.transfers.delete(row.id);
    return {ok:true,id:row.id,mode:'upload',path:row.destination,totalBytes:row.totalBytes,sha256:row.sha256};
  }
  async beginDownload(input={}){
    await this.cleanup();
    if(this.transfers.size>=this.maxActive)throw new LightScpFileError('scp_transfer_limit',503);
    const source=await resolveDownloadSource(input.source,this.policy),st=await fsp.stat(source);
    if(!st.isFile())throw new LightScpFileError('scp_source_not_file',409);
    if(st.size>this.maxTransferBytes)throw new LightScpFileError('scp_transfer_too_large',413);
    const chunkBytes=Math.max(65536,Math.min(Number(input.chunkBytes)||this.defaultChunkBytes,this.maxChunkBytes));
    const totalChunks=Math.ceil(st.size/chunkBytes),hash=await hashFile(source);
    const id=`lscp_${crypto.randomBytes(18).toString('base64url')}`,now=Date.now();
    const row={id,mode:'download',source,totalBytes:st.size,sourceMtimeMs:st.mtimeMs,sourceCtimeMs:st.ctimeMs,chunkBytes,totalChunks,sha256:hash,sent:new Map(),sentBytes:0,createdAt:now,lastSeenAt:now,expiresAt:now+this.ttlMs};
    this.transfers.set(id,row);
    return this._view(row);
  }
  async readDownloadChunk(id,input={}){
    const row=await this._get(id);
    if(row.mode!=='download')throw new LightScpFileError('scp_transfer_mode_mismatch',409);
    const index=Number(input.index);
    if(!Number.isSafeInteger(index)||index<0||index>=row.totalChunks)throw new LightScpFileError('scp_invalid_chunk_index');
    const current=await fsp.stat(row.source).catch(()=>null);
    if(!current?.isFile()||current.size!==row.totalBytes||current.mtimeMs!==row.sourceMtimeMs||current.ctimeMs!==row.sourceCtimeMs)throw new LightScpFileError('scp_download_source_changed',409);
    const offset=index*row.chunkBytes;
    const length=Math.min(row.chunkBytes,row.totalBytes-offset),buffer=Buffer.alloc(length);
    const fh=await fsp.open(row.source,'r');
    let bytesRead=0;
    try{({bytesRead}=await fh.read(buffer,0,length,offset));}finally{await fh.close();}
    if(bytesRead!==length)throw new LightScpFileError('scp_download_source_changed',409);
    const data=buffer.subarray(0,bytesRead),hash=sha256(data),prior=row.sent.get(index);
    if(!prior){row.sent.set(index,{sha256:hash,bytes:bytesRead});row.sentBytes+=bytesRead;}
    else if(prior.sha256!==hash||prior.bytes!==bytesRead)throw new LightScpFileError('scp_download_source_changed',409);
    row.lastSeenAt=Date.now();row.expiresAt=row.lastSeenAt+this.ttlMs;
    return {ok:true,id:row.id,index,offset,bytes:bytesRead,sha256:hash,data:data.toString('base64url'),complete:row.sent.size===row.totalChunks};
  }
  async cancel(id){
    const row=await this._get(id,false);
    if(row.mode==='upload'&&row.tempPath)await fsp.rm(row.tempPath,{force:true}).catch(()=>{});
    this.transfers.delete(row.id);
    return {ok:true,id:row.id,cancelled:true};
  }
}
