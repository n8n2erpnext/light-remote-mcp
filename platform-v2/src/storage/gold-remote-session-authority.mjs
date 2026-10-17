/**
 * PostgreSQL-only remote working context for the independent Gold Core.
 *
 * Web-login sessions (lr_sessions), durable Agent identity (lr_agent_clients),
 * and remote execution sessions (lr_remote_sessions) are distinct entities.
 * This is NOT a remote command executor: clients/worker job state must be
 * fully cut over and verified separately before Gold production admission.
 */
import crypto from 'node:crypto';
import {GOLD_TEAM_ENTITLED_SQL} from './gold-team-entitlement.mjs';

const ID=/^[A-Za-z0-9._:-]{1,180}$/;
const PRESETS=new Map([['15m',900000],['30m',1800000],['45m',2700000],['60m',3600000]]);
const err=(code,status=403)=>Object.assign(new Error(code),{code,status});
const id=value=>{
 const s=String(value||'');
 if(!ID.test(s))throw err('gold_context_invalid_id',400);
 return s;
};
const ms=value=>new Date(value).getTime();
const view=row=>{
 const last=ms(row.last_seen_at),expiry=ms(row.expires_at);
 return {sessionId:row.session_id,clientSessionId:row.client_session_id,
  accountId:row.actor_account_id,ownerAccountId:row.owner_account_id,
  agentId:row.agent_id,deviceId:row.device_id,nodeId:row.node_id,
  workspace:row.workspace,gracePreset:row.grace_preset,
  graceMs:Number(row.grace_ms),state:'active',
  lastSeenAt:last,expiresAt:expiry,
  reconnectCount:Number(row.reconnect_count||0)};
};

export class GoldPgRemoteSessionAuthority{
 constructor({pool,agentClients,now=()=>Date.now()}={}){
  if(typeof pool?.connect!=='function')throw Error('gold_remote_session_pg_pool_required');
  if(typeof agentClients?.resolve!=='function')
   throw Error('gold_remote_session_agent_binding_required');
  Object.assign(this,{pool,agentClients,now});
 }
 async context({clientSessionId,agentId,agentProof,deviceId=null,
  workspace=null,gracePreset=null}={}){
  const sid=id(clientSessionId),agent=id(agentId);
  const requested=deviceId==null?null:id(deviceId);
  if(workspace!==null&&(typeof workspace!=='string'||workspace.length>512||
   workspace.includes('\0')))throw err('gold_context_workspace_invalid',400);
  const preset=gracePreset==null?null:String(gracePreset);
  if(preset!==null&&!PRESETS.has(preset))
   throw err('gold_context_grace_preset_invalid',400);
  // Resolves owner OR member independently through the PG grant, Account,
  // device and Team membership authority. No body-supplied actor ID.
  const authorized=await this.agentClients.resolve({
   clientSessionId:sid,agentId:agent,agentProof,deviceId:requested});
  const b=authorized.binding,dev=authorized.device;
  if(!b||b.clientSessionId!==sid||b.agentId!==agent||
   !ID.test(String(b.accountId||''))||!ID.test(String(b.grantId||''))||
   !ID.test(String(b.connectionId||''))||!ID.test(String(b.deviceId||'')))
   throw err('gold_context_agent_binding_unverified',401);
  const client=await this.pool.connect();let open=false;
  try{
   await client.query('BEGIN');open=true;
   // A cross-process, transaction-held lane lock serializes competing
   // reconnects before the unique active-session constraint is checked.
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    [b.accountId+'|'+agent+'|'+b.deviceId]);
   // Protect the transaction against a grant/device/team revocation between
   // initial resolve() and remote-session persistence.
   const check=await client.query(
    "SELECT g.grant_id,g.account_id AS owner_account_id,g.purpose,"+
    "g.device_id,g.connection_id,d.node_id,"+
    "g.expires_at AS grant_expires_at,g.absolute_expires_at,"+
    "cn.hard_expires_at,ac.expires_at AS client_expires_at "+
    "FROM lr_ab_grants g "+
    "JOIN lr_device_connections cn ON cn.connection_id=g.connection_id "+
    "JOIN lr_devices d ON d.device_id=g.device_id "+
    "JOIN lr_agent_clients ac ON ac.client_session_id=$5 "+
    "JOIN lr_accounts actor ON actor.account_id=ac.account_id "+
    "JOIN lr_accounts owner ON owner.account_id=g.account_id "+
    "WHERE g.grant_id=$1 AND g.device_id=$2 AND g.connection_id=$3 "+
    "AND g.agent_id=$4 AND ac.agent_id=$4 AND ac.account_id=$6 "+
    "AND ac.closed_at IS NULL AND ac.expires_at>now() "+
    "AND actor.status='active' AND owner.status='active' "+
    "AND g.closed_at IS NULL AND g.expires_at>now() "+
    "AND g.absolute_expires_at>now() AND cn.closed_at IS NULL "+
    "AND cn.hard_expires_at>now() AND d.state<>'revoked' "+
    "FOR SHARE OF g,cn,d,ac,actor,owner",
    [b.grantId,b.deviceId,b.connectionId,agent,sid,b.accountId]);
   const grant=check.rows?.[0];
   if(!grant||grant.purpose!==b.purpose||!grant.node_id)
    throw err('gold_context_grant_expired_or_revoked');
   // A binding can be replaced by a concurrent attach between the initial
   // resolve and this transaction. Lock the *actual* association again,
   // preventing a stale grant from becoming a new remote session.
   const bindingTable=grant.purpose==='team-member'?
    'lr_agent_team_bindings':'lr_agent_bindings';
   const actorColumn=grant.purpose==='team-member'?
    'actor_account_id':'account_id';
   const bindingProof=await client.query(
    'SELECT grant_id FROM '+bindingTable+
    ' WHERE client_session_id=$1 AND device_id=$2 AND grant_id=$3 '+
    'AND connection_id=$4 AND '+actorColumn+'=$5 FOR SHARE',
    [sid,b.deviceId,b.grantId,b.connectionId,b.accountId]);
   if(bindingProof.rows?.length!==1)throw err('gold_context_binding_changed');
   if(grant.purpose==='device'){
    if(grant.owner_account_id!==b.accountId)throw err('gold_context_actor_mismatch');
   }else if(grant.purpose==='team-member'){
    const m=await client.query(
     "SELECT tag.grant_id FROM lr_ab_team_actor_grants tag "+
     "JOIN lr_teams t ON t.team_id=tag.team_id "+
     "JOIN lr_team_members m ON m.team_id=t.team_id "+
     "AND m.account_id=tag.actor_account_id "+
     "JOIN lr_team_devices td ON td.team_id=t.team_id "+
     "AND td.device_id=tag.device_id "+
     "WHERE tag.grant_id=$1 AND tag.actor_account_id=$2 "+
     "AND tag.device_id=$3 AND t.owner_account_id=$4 AND m.state='active' "+
     "AND "+GOLD_TEAM_ENTITLED_SQL+" "+
     "FOR SHARE OF tag,t,m,td",
     [b.grantId,b.accountId,b.deviceId,grant.owner_account_id]);
    if(m.rows?.length!==1)throw err('gold_context_team_access_revoked');
   }else throw err('gold_context_purpose_denied');
   const existing=await client.query(
    "SELECT * FROM lr_remote_sessions "+
    "WHERE actor_account_id=$1 AND agent_id=$2 AND device_id=$3 "+
    "AND closed_at IS NULL FOR UPDATE",
    [b.accountId,agent,b.deviceId]);
   let old=existing.rows?.[0]||null;
   // Re-approval must never let a new A/B grant, device connection, or
   // Agent Client inherit an old execution session ID. Old jobs may still
   // refer to that ID; preserve the history but close its execution lane.
   const stale=old&&(old.client_session_id!==sid||
    old.grant_id!==b.grantId||old.connection_id!==b.connectionId||
    old.grant_purpose!==b.purpose||
    old.owner_account_id!==grant.owner_account_id||
    old.node_id!==grant.node_id);
   if(old&&(stale||ms(old.expires_at)<=this.now())){
    await client.query(
     "UPDATE lr_remote_sessions SET closed_at=now(),hold_reason=$2 "+
     "WHERE session_id=$1",
     [old.session_id,stale?'authorization_changed':'expired']);
    old=null;
   }
   const chosen=preset||old?.grace_preset||'60m';
   const grace=PRESETS.get(chosen);
   const cwd=workspace===null?(old?.workspace||''):workspace;
   const expires=Math.min(this.now()+grace,
    ...[grant.grant_expires_at,grant.absolute_expires_at,
     grant.hard_expires_at,grant.client_expires_at].map(ms));
   // Every remote session lease is bounded by the shortest upstream lease.
   // If the grant changes or expires, a later call must reauthorize anew.
   if(!Number.isFinite(expires)||expires<=this.now())
    throw err('gold_context_upstream_lease_expired');
   let row;
   if(old){
    const updated=await client.query(
     "UPDATE lr_remote_sessions SET client_session_id=$2,owner_account_id=$3,"+
     "connection_id=$4,grant_id=$5,grant_purpose=$6,node_id=$7,"+
     "workspace=$8,grace_preset=$9,grace_ms=$10,last_seen_at=now(),"+
     "expires_at=to_timestamp($11/1000.0),hold_reason=NULL,"+
     "reconnect_count=reconnect_count+1 WHERE session_id=$1 RETURNING *",
     [old.session_id,sid,grant.owner_account_id,b.connectionId,b.grantId,
      b.purpose,grant.node_id,cwd,chosen,grace,expires]);
    row=updated.rows?.[0];
   }else{
    const sessionId='s_'+this.now().toString(36)+'_'+crypto.randomBytes(8).toString('hex');
    const inserted=await client.query(
     "INSERT INTO lr_remote_sessions(session_id,client_session_id,"+
     "actor_account_id,owner_account_id,agent_id,device_id,node_id,"+
     "connection_id,grant_id,grant_purpose,workspace,grace_preset,grace_ms,expires_at) "+
     "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,to_timestamp($14/1000.0)) "+
     "RETURNING *",
     [sessionId,sid,b.accountId,grant.owner_account_id,agent,b.deviceId,
      grant.node_id,b.connectionId,b.grantId,b.purpose,cwd,chosen,grace,expires]);
    row=inserted.rows?.[0];
   }
   if(!row)throw err('gold_context_session_persist_failed',503);
   await client.query('COMMIT');open=false;
   const session=view(row);
   return {context:{clientSessionId:sid,agentId:agent,deviceId:b.deviceId,
    sessionId:session.sessionId,nodeId:grant.node_id,
    workspace:session.workspace,gracePreset:session.gracePreset,
    platform:dev.platform,architecture:dev.architecture,
    deviceState:dev.state,connectionState:authorized.connection?.state||'connected'},
    session};
  }catch(e){
   if(open)await client.query('ROLLBACK').catch(()=>{});
   throw e;
  }finally{client.release()}
 }
}
