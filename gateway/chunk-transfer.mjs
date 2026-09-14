import crypto from 'node:crypto';

function transferError(message,status=400){const error=new Error(message);error.status=status;return error;}
function sha256Hex(value){return crypto.createHash('sha256').update(value).digest('hex');}
function ownerKey(owner){
  const clientSessionId=String(owner?.clientSessionId||'').trim(),agentId=String(owner?.agentId||'').trim(),deviceId=String(owner?.deviceId||'').trim();
  if(!clientSessionId||!agentId||!deviceId)throw transferError('transfer_owner_required',400);
  return `${clientSessionId}|${agentId}|${deviceId}`;
}
function transferId(value){const id=String(value||'').trim();if(!/^lt_[A-Za-z0-9_-]{20,80}$/.test(id))throw transferError('invalid_transfer_id',400);return id;}
function digest(value,name='sha256'){const out=String(value||'').trim().toLowerCase();if(!/^[0-9a-f]{64}$/.test(out))throw transferError(`invalid_${name}`,400);return out;}
function decodeBase64url(value){
  const raw=String(value||'').trim();
  if(!raw||!/^[A-Za-z0-9_-]+$/.test(raw)||raw.length%4===1)throw transferError('invalid_chunk_encoding',400);
  const data=Buffer.from(raw,'base64url');if(data.toString('base64url')!==raw)throw transferError('invalid_chunk_encoding',400);return data;
}
function missingRanges(totalChunks,chunks){
  const out=[];let start=null;
  for(let i=0;i<totalChunks;i++){const missing=!chunks.has(i);if(missing&&start===null)start=i;if(!missing&&start!==null){out.push({start,end:i-1});start=null;}}
  if(start!==null)out.push({start,end:totalChunks-1});return out;
}

export class ChunkTransferRegistry {
  constructor(options={}){
    const o=options||{};
    this.ttlMs=Math.max(30000,Number(o.ttlMs)||600000);
    this.maxTransferBytes=Math.max(1024,Number(o.maxTransferBytes)||8388608);
    this.maxChunkBytes=Math.max(512,Number(o.maxChunkBytes)||5120);
    this.maxChunks=Math.max(1,Number(o.maxChunks)||2048);
    this.maxActivePerOwner=Math.max(1,Number(o.maxActivePerOwner)||4);
    this.maxActiveTotal=Math.max(1,Number(o.maxActiveTotal)||64);
    this.maxMemoryBytes=Math.max(this.maxChunkBytes,Number(o.maxMemoryBytes)||16777216);
    this.transfers=new Map();this.memoryBytes=0;
  }
  cleanup(now=Date.now()){for(const [id,row] of this.transfers)if(row.expiresAt<=now)this._delete(id);}
  _delete(id){const row=this.transfers.get(id);if(!row)return false;this.memoryBytes=Math.max(0,this.memoryBytes-row.receivedBytes);this.transfers.delete(id);return true;}
  _get(owner,id,touch=true){
    this.cleanup();id=transferId(id);const row=this.transfers.get(id);if(!row)throw transferError('transfer_not_found',404);
    if(row.ownerKey!==ownerKey(owner))throw transferError('transfer_owner_mismatch',403);
    if(touch){row.lastSeenAt=Date.now();row.expiresAt=row.lastSeenAt+this.ttlMs;}return row;
  }
  begin(owner,input={}){
    this.cleanup();
    const key=ownerKey(owner);
    const purpose=String(input.purpose||'operator-payload');
    const bytes=Number(input.totalBytes);
    const count=Number(input.totalChunks);
    const hash=digest(input.sha256);
    if(!/^[a-z0-9._:-]{1,64}$/.test(purpose))throw transferError('invalid_transfer_purpose',400);
    if(!Number.isSafeInteger(bytes)||bytes<1||bytes>this.maxTransferBytes)throw transferError('invalid_transfer_size',413);
    if(!Number.isSafeInteger(count)||count<1||count>this.maxChunks)throw transferError('invalid_transfer_chunk_count',400);
    if(count*this.maxChunkBytes<bytes)throw transferError('transfer_chunk_count_too_small',400);
    const active=[...this.transfers.values()].filter(row=>row.ownerKey===key).length;
    if(active>=this.maxActivePerOwner)throw transferError('transfer_owner_limit',429);
    if(this.transfers.size>=this.maxActiveTotal)throw transferError('transfer_global_limit',503);
    const now=Date.now();
    const id=`lt_${crypto.randomBytes(18).toString('base64url')}`;
    const row={id,ownerKey:key,purpose,totalBytes:bytes,totalChunks:count,sha256:hash,chunks:new Map(),receivedBytes:0,createdAt:now,lastSeenAt:now,expiresAt:now+this.ttlMs,verifiedAt:null};
    this.transfers.set(id,row);
    return this.view(owner,id);
  }
  put(owner,id,input={}){
    const row=this._get(owner,id);
    const index=Number(input.index);
    if(!Number.isSafeInteger(index)||index<0||index>=row.totalChunks)throw transferError('invalid_transfer_chunk_index',400);
    const data=decodeBase64url(input.data);
    if(data.length>this.maxChunkBytes)throw transferError('transfer_chunk_too_large',413);
    const hash=digest(input.sha256,'chunk_sha256');
    if(sha256Hex(data)!==hash)throw transferError('transfer_chunk_hash_mismatch',409);
    const prior=row.chunks.get(index);
    if(prior){
      if(prior.sha256!==hash||prior.data.length!==data.length||!prior.data.equals(data))throw transferError('transfer_chunk_conflict',409);
      return this.view(owner,row.id);
    }
    if(row.receivedBytes+data.length>row.totalBytes)throw transferError('transfer_size_exceeded',413);
    if(this.memoryBytes+data.length>this.maxMemoryBytes)throw transferError('transfer_memory_limit',503);
    row.chunks.set(index,{data,sha256:hash});
    row.receivedBytes+=data.length;this.memoryBytes+=data.length;
    return this.view(owner,row.id);
  }
  view(owner,id){
    const row=this._get(owner,id);
    const missing=missingRanges(row.totalChunks,row.chunks);
    return {id:row.id,purpose:row.purpose,totalBytes:row.totalBytes,totalChunks:row.totalChunks,sha256:row.sha256,receivedBytes:row.receivedBytes,receivedChunks:row.chunks.size,missingRanges:missing,complete:missing.length===0&&row.receivedBytes===row.totalBytes,createdAt:row.createdAt,lastSeenAt:row.lastSeenAt,expiresAt:row.expiresAt,verifiedAt:row.verifiedAt};
  }
  assemble(owner,id){
    const row=this._get(owner,id);
    const missing=missingRanges(row.totalChunks,row.chunks);
    if(missing.length)throw transferError('transfer_incomplete',409);
    const parts=[];for(let i=0;i<row.totalChunks;i++)parts.push(row.chunks.get(i).data);
    const data=Buffer.concat(parts);
    if(data.length!==row.totalBytes)throw transferError('transfer_size_mismatch',409);
    if(sha256Hex(data)!==row.sha256)throw transferError('transfer_hash_mismatch',409);
    row.verifiedAt=Date.now();
    return {transfer:this.view(owner,row.id),data};
  }
  release(owner,id){const row=this._get(owner,id,false);this._delete(row.id);return {ok:true,id:row.id,state:'released'};}
  cancel(owner,id){const row=this._get(owner,id,false);this._delete(row.id);return {ok:true,id:row.id,state:'cancelled'};}
}

export { sha256Hex };
