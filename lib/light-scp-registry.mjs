import { LightScpFileRegistry, LightScpFileError } from './light-scp-file.mjs';

function ownerKey(owner={}){
  const accountId=String(owner.accountId||'').trim(),deviceId=String(owner.deviceId||'').trim();
  const sessionId=String(owner.sessionId||'').trim(),agentId=String(owner.agentId||'').trim();
  if(!accountId||!deviceId||!sessionId||!agentId)throw new LightScpFileError('scp_owner_required',400);
  return `${accountId}|${deviceId}|${sessionId}|${agentId}`;
}

export class LightScpRegistry {
  constructor(options={}){this.files=new LightScpFileRegistry(options);this.owners=new Map();this.recent=new Map();this.maxRecent=48;this.recentTtlMs=10*60*1000;}
  async cleanup(){
    await this.files.cleanup();
    for(const id of this.owners.keys())if(!this.files.transfers.has(id))this.owners.delete(id);
    for(const [id,row] of this.recent)if(Date.now()-row.updatedAt>this.recentTtlMs)this.recent.delete(id);
  }
  async _owned(owner,id){
    await this.cleanup();
    const expected=this.owners.get(String(id||''));
    if(!expected)throw new LightScpFileError('scp_transfer_not_found',404);
    if(expected!==ownerKey(owner))throw new LightScpFileError('scp_owner_mismatch',403);
    return id;
  }
  _summary(value,owner,phase=null,verified=false){
    const bytes=Math.max(0,Number(value.progressBytes)||0),total=Math.max(0,Number(value.totalBytes)||0);
    return {transferId:String(value.id),sessionId:String(owner.sessionId||''),direction:value.mode==='upload'?'upload':'download',phase:phase||(bytes===total?(value.mode==='upload'?'verifying':'served'):'transferring'),progressBytes:bytes,totalBytes:total,progressChunks:Number(value.progressChunks)||0,totalChunks:Number(value.totalChunks)||0,verified,updatedAt:Date.now()};
  }
  _remember(value,owner,phase=null,verified=false){
    const item=this._summary(value,owner,phase,verified);this.recent.delete(item.transferId);this.recent.set(item.transferId,item);
    while(this.recent.size>this.maxRecent)this.recent.delete(this.recent.keys().next().value);
    return item;
  }
  // Device-local Wall owner view only. No raw file paths, data, SHA, or owner credentials.
  async wallSnapshot(){
    await this.cleanup();
    const result=[];for(const [id,row] of this.recent){if(this.files.transfers.has(id)||['completed','cancelled','failed'].includes(row.phase))result.push({...row});}
    return result.slice(-this.maxRecent).sort((a,b)=>b.updatedAt-a.updatedAt);
  }
  async beginUpload(owner,input){const value=await this.files.beginUpload(input);this.owners.set(value.id,ownerKey(owner));this._remember(value,owner,'preparing');return value;}
  async putUploadChunk(owner,id,input){await this._owned(owner,id);const value=await this.files.putUploadChunk(id,input);this._remember(value,owner);return value;}
  async commitUpload(owner,id){await this._owned(owner,id);let value;try{value=await this.files.commitUpload(id);}catch(error){const row=this.recent.get(String(id));if(row){row.phase='failed';row.lastErrorCode=/^scp_[a-z_]+$/.test(String(error.message||''))?error.message:'scp_commit_failed';row.updatedAt=Date.now();}throw error;}this.owners.delete(id);this._remember({id,mode:'upload',totalBytes:value.totalBytes,progressBytes:value.totalBytes,progressChunks:this.recent.get(id)?.totalChunks??0,totalChunks:this.recent.get(id)?.totalChunks??0},owner,'completed',true);return value;}
  async beginDownload(owner,input){const value=await this.files.beginDownload(input);this.owners.set(value.id,ownerKey(owner));this._remember(value,owner,'preparing');return value;}
  async readDownloadChunk(owner,id,input){await this._owned(owner,id);const chunk=await this.files.readDownloadChunk(id,input);const value=await this.files.status(id);this._remember(value,owner);return chunk;}
  async status(owner,id){await this._owned(owner,id);return this.files.status(id);}
  async cancel(owner,id){await this._owned(owner,id);const previous=this.recent.get(String(id));const value=await this.files.cancel(id);this.owners.delete(id);if(previous)this._remember({id,mode:previous.direction,totalBytes:previous.totalBytes,progressBytes:previous.progressBytes,progressChunks:previous.progressChunks,totalChunks:previous.totalChunks},owner,'cancelled');return value;}
}
