import { LightScpFileRegistry, LightScpFileError } from './light-scp-file.mjs';

function ownerKey(owner={}){
  const accountId=String(owner.accountId||'').trim(),deviceId=String(owner.deviceId||'').trim();
  const sessionId=String(owner.sessionId||'').trim(),agentId=String(owner.agentId||'').trim();
  if(!accountId||!deviceId||!sessionId||!agentId)throw new LightScpFileError('scp_owner_required',400);
  return `${accountId}|${deviceId}|${sessionId}|${agentId}`;
}

export class LightScpRegistry {
  constructor(options={}){this.files=new LightScpFileRegistry(options);this.owners=new Map();}
  async cleanup(){
    await this.files.cleanup();
    for(const id of this.owners.keys())if(!this.files.transfers.has(id))this.owners.delete(id);
  }
  async _owned(owner,id){
    await this.cleanup();
    const expected=this.owners.get(String(id||''));
    if(!expected)throw new LightScpFileError('scp_transfer_not_found',404);
    if(expected!==ownerKey(owner))throw new LightScpFileError('scp_owner_mismatch',403);
    return id;
  }
  async beginUpload(owner,input){const value=await this.files.beginUpload(input);this.owners.set(value.id,ownerKey(owner));return value;}
  async putUploadChunk(owner,id,input){await this._owned(owner,id);return this.files.putUploadChunk(id,input);}
  async commitUpload(owner,id){await this._owned(owner,id);const value=await this.files.commitUpload(id);this.owners.delete(id);return value;}
  async beginDownload(owner,input){const value=await this.files.beginDownload(input);this.owners.set(value.id,ownerKey(owner));return value;}
  async readDownloadChunk(owner,id,input){await this._owned(owner,id);return this.files.readDownloadChunk(id,input);}
  async status(owner,id){await this._owned(owner,id);return this.files.status(id);}
  async cancel(owner,id){await this._owned(owner,id);const value=await this.files.cancel(id);this.owners.delete(id);return value;}
}
