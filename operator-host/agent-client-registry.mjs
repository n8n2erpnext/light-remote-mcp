import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_CLIENT_TTL_MS = 15 * 60 * 1000;
const MAX_CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class AgentClientRegistryError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
function validId(value,name){
  const text=String(value||'').trim();
  if(!/^[A-Za-z0-9._:-]{1,180}$/.test(text))throw new AgentClientRegistryError(name);
  return text;
}
export class AgentClientRegistry {
  constructor({stateFile=null,emit=()=>{},now=()=>Date.now(),ttlMs=DEFAULT_CLIENT_TTL_MS}={}){
    this.stateFile=stateFile;this.emit=emit;this.now=now;this.ttlMs=Number(ttlMs);this.rows=new Map();this.loadError=null;
    if(!Number.isFinite(this.ttlMs)||this.ttlMs<MIN_CLIENT_TTL_MS||this.ttlMs>MAX_CLIENT_TTL_MS)throw new AgentClientRegistryError('invalid_agent_client_ttl');
    this._load();
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const tmp=`${this.stateFile}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify({schemaVersion:1,clients:[...this.rows.values()]},null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);
  }
  _load(){
    if(!this.stateFile||!fs.existsSync(this.stateFile))return;
    try{const parsed=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));for(const row of Array.isArray(parsed.clients)?parsed.clients:[])if(row?.clientSessionId)this.rows.set(String(row.clientSessionId),row);}
    catch(error){this.rows.clear();this.loadError=error?.message||'invalid_agent_client_state';}
  }
  _row(clientSessionId,{agentId=null,accountId=null,touch=false}={}){
    const id=validId(clientSessionId,'invalid_agent_client_id'),row=this.rows.get(id),now=this.now();
    if(!row||row.closedAt)throw new AgentClientRegistryError('agent_client_required',401);
    if(now>=Number(row.expiresAt||0)){this.close(id,'expired');throw new AgentClientRegistryError('agent_client_expired',401);}
    if(agentId!=null&&row.agentId!==String(agentId))throw new AgentClientRegistryError('agent_client_agent_mismatch',403);
    if(accountId!=null&&row.accountId!==String(accountId))throw new AgentClientRegistryError('agent_client_account_mismatch',403);
    if(touch){row.lastActivityAt=now;this._persist();}
    return row;
  }
  attach({clientSessionId=null,accountId,agentId,grant,pairingRequestId=null}={}){
    const aid=validId(accountId,'invalid_agent_client_account'),agent=validId(agentId,'invalid_agent_client_agent');
    if(!grant?.grantId||!grant?.deviceId||!grant?.connectionId)throw new AgentClientRegistryError('invalid_agent_client_grant');
    const requestId=pairingRequestId?validId(pairingRequestId,'invalid_agent_client_pairing_request'):null;
    const now=this.now();let row;
    if(clientSessionId)row=this._row(clientSessionId,{agentId:agent,accountId:aid});
    else if(requestId){for(const candidate of this.rows.values()){const prior=candidate.bindings?.[grant.deviceId];if(!candidate.closedAt&&candidate.accountId===aid&&candidate.agentId===agent&&prior?.pairingRequestId===requestId&&prior?.grantId===grant.grantId){row=candidate;break;}}}
    if(!row){const id=`lrc_${crypto.randomBytes(18).toString('base64url')}`;row={clientSessionId:id,accountId:aid,agentId:agent,createdAt:now,lastActivityAt:now,expiresAt:now+this.ttlMs,closedAt:null,closeReason:null,bindings:{}};this.rows.set(id,row);this.emit({type:'agent_client_created',accountId:aid,agentId:agent,clientSessionId:id,status:'active'});}
    row.bindings=row.bindings&&typeof row.bindings==='object'?row.bindings:{};
    const previous=row.bindings[grant.deviceId];row.bindings[grant.deviceId]={deviceId:grant.deviceId,grantId:grant.grantId,connectionId:grant.connectionId,boundAt:previous?.boundAt||now,lastActivityAt:now,pairingRequestId:requestId||previous?.pairingRequestId||null};row.lastActivityAt=now;
    this._persist();this.emit({type:'agent_client_device_bound',accountId:aid,agentId:agent,clientSessionId:row.clientSessionId,deviceId:grant.deviceId,connectionId:grant.connectionId,grantId:grant.grantId,status:'authorized'});
    return this.view(row.clientSessionId,{agentId:agent});
  }
  view(clientSessionId,{agentId=null,touch=false}={}){const row=this._row(clientSessionId,{agentId,touch});return {...row,bindings:Object.values(row.bindings||{}).map(x=>({...x}))};}
  resolve(clientSessionId,{agentId,deviceId,touch=true}={}){
    const row=this._row(clientSessionId,{agentId,touch}),did=validId(deviceId,'invalid_agent_client_device'),binding=row.bindings?.[did];
    if(!binding)throw new AgentClientRegistryError('agent_client_device_not_authorized',403);
    if(touch){binding.lastActivityAt=this.now();this._persist();}
    return {...binding,clientSessionId:row.clientSessionId,agentId:row.agentId,accountId:row.accountId};
  }
  removeDevice(deviceId,reason='device_access_closed'){
    const did=validId(deviceId,'invalid_agent_client_device');let count=0;
    for(const row of this.rows.values())if(!row.closedAt&&row.bindings?.[did]){delete row.bindings[did];count++;this.emit({type:'agent_client_device_unbound',accountId:row.accountId,agentId:row.agentId,clientSessionId:row.clientSessionId,deviceId:did,status:'removed',reason:String(reason||'removed').slice(0,80)});}
    if(count)this._persist();return count;
  }
  close(clientSessionId,reason='closed'){
    const id=validId(clientSessionId,'invalid_agent_client_id'),row=this.rows.get(id);if(!row)throw new AgentClientRegistryError('agent_client_not_found',404);
    if(!row.closedAt){row.closedAt=this.now();row.closeReason=String(reason||'closed').slice(0,80);this._persist();this.emit({type:'agent_client_closed',accountId:row.accountId,agentId:row.agentId,clientSessionId:id,status:'closed',reason:row.closeReason});}
    return this.viewUnsafe(row);
  }
  viewUnsafe(row){return {...row,bindings:Object.values(row.bindings||{}).map(x=>({...x}))};}
  reap(){const now=this.now();let changed=false,count=0;for(const row of this.rows.values())if(!row.closedAt&&now>=Number(row.expiresAt||0)){row.closedAt=now;row.closeReason='expired';changed=true;count++;this.emit({type:'agent_client_closed',accountId:row.accountId,agentId:row.agentId,clientSessionId:row.clientSessionId,status:'closed',reason:'expired'});}if(changed)this._persist();return count;}
}
