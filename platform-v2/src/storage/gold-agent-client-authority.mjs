/**
 * Gold Agent Client binding authority. Stores durable Agent↔grant↔device
 * relationships in PostgreSQL, not JSON snapshots or Redis leases.
 * Uses the historical RC50 owner-only binding schema for owner grants and
 * the Gold 019 team-binding table for approved Team member actors.
 */
import crypto from 'node:crypto';
const ID=/^[A-Za-z0-9._:-]{1,180}$/;
const fail=(code,status=403)=>Object.assign(new Error(code),{code,status});
const id=(value,label='gold_agent_invalid_id')=>{
 const text=String(value||'');
 if(!ID.test(text))throw fail(label,400);
 return text;
};
const epoch=value=>new Date(value).getTime();

export class GoldPgAgentClientAuthority{
 constructor({pool,verifyAgentPrincipal,now=()=>Date.now(),ttlMs=86400000}={}){
  if(typeof pool?.connect!=='function'||typeof pool?.query!=='function')
   throw Error('gold_agent_pg_pool_required');
  if(typeof verifyAgentPrincipal!=='function')
   throw Error('gold_agent_proof_verifier_required');
  if(!Number.isSafeInteger(ttlMs)||ttlMs<900000||ttlMs>604800000)
   throw Error('gold_agent_invalid_client_ttl');
  Object.assign(this,{pool,verifyAgentPrincipal,now,ttlMs});
 }
 async identity({agentId,agentProof}){
  const agent=id(agentId);
  const proof=await this.verifyAgentPrincipal({agentId:agent,agentProof});
  if(!proof?.accountId)throw fail('gold_agent_ingress_unverified',401);
  return {agentId:agent,actorAccountId:id(proof.accountId)};
 }
 async tx(fn){
  const c=await this.pool.connect();let opened=false;
  try{
   await c.query('BEGIN');opened=true;
   const answer=await fn(c);await c.query('COMMIT');opened=false;
   return answer;
  }catch(error){if(opened)await c.query('ROLLBACK').catch(()=>{});throw error}
  finally{c.release()}
 }
 async attach({agentId,agentProof,grantId,clientSessionId=null,pairingRequestId=null}={}){
  const identity=await this.identity({agentId,agentProof});
  const grant=id(grantId);
  const session=clientSessionId==null?null:id(clientSessionId);
  const request=pairingRequestId==null?null:id(pairingRequestId);
  const now=this.now();
  return this.tx(async c=>{
   // Row locks serialize binding against concurrent owner/device revocation.
   const auth=await c.query(
    "SELECT g.grant_id,g.account_id AS owner_account_id,g.device_id,"+
    "g.connection_id,g.agent_id,g.purpose,g.expires_at,g.absolute_expires_at,"+
    "cn.hard_expires_at,d.state,d.node_id,d.display_name,d.platform,d.architecture,"+
    "owner.status AS owner_status,actor.status AS actor_status "+
    "FROM lr_ab_grants g JOIN lr_device_connections cn ON cn.connection_id=g.connection_id "+
    "JOIN lr_devices d ON d.device_id=g.device_id "+
    "JOIN lr_accounts owner ON owner.account_id=g.account_id "+
    "JOIN lr_accounts actor ON actor.account_id=$3 "+
    "WHERE g.grant_id=$1 AND g.agent_id=$2 AND g.closed_at IS NULL "+
    "AND g.expires_at>now() AND g.absolute_expires_at>now() "+
    "AND cn.closed_at IS NULL AND cn.hard_expires_at>now() "+
    "FOR SHARE OF g,cn,d,owner,actor",
    [grant,identity.agentId,identity.actorAccountId]);
   const g=auth.rows?.[0];
   if(!g||g.owner_status!=='active'||g.actor_status!=='active'||g.state==='revoked')
    throw fail('gold_agent_grant_inactive_or_revoked');
   if(g.purpose==='device'){
    if(g.owner_account_id!==identity.actorAccountId)
     throw fail('gold_agent_owner_actor_mismatch');
   }else if(g.purpose==='team-member'){
    const member=await c.query(
     "SELECT tag.team_id FROM lr_ab_team_actor_grants tag "+
     "JOIN lr_teams t ON t.team_id=tag.team_id "+
     "JOIN lr_team_members m ON m.team_id=t.team_id "+
     "JOIN lr_team_devices td ON td.team_id=t.team_id "+
     "WHERE tag.grant_id=$1 AND tag.actor_account_id=$2 AND tag.device_id=$3 "+
     "AND t.owner_account_id=$4 AND m.account_id=$2 AND m.state='active' "+
     "AND td.device_id=$3 FOR SHARE OF tag,t,m,td",
     [grant,identity.actorAccountId,g.device_id,g.owner_account_id]);
    if(member.rows?.length!==1)throw fail('gold_agent_team_access_revoked');
   }else throw fail('gold_agent_grant_purpose_invalid');
   if(request){
    const pair=await c.query(
     "SELECT request_id FROM lr_ab_requests "+
     "WHERE request_id=$1 AND approved_grant_id=$2 AND state='approved' FOR SHARE",
     [request,grant]);
    if(pair.rows?.length!==1)throw fail('gold_agent_pairing_request_mismatch');
   }
   const clientId=session||'lrc_'+crypto.randomBytes(18).toString('base64url');
   let client;
   if(session){
    const previous=await c.query(
     "SELECT client_session_id,account_id,agent_id,expires_at,closed_at "+
     "FROM lr_agent_clients WHERE client_session_id=$1 FOR UPDATE",[session]);
    client=previous.rows?.[0];
    if(!client||client.closed_at||epoch(client.expires_at)<=now||
       client.account_id!==identity.actorAccountId||client.agent_id!==identity.agentId)
     throw fail('gold_agent_client_invalid_or_expired');
   }else{
    const created=await c.query(
     "INSERT INTO lr_agent_clients(client_session_id,account_id,agent_id,expires_at) "+
     "VALUES($1,$2,$3,to_timestamp($4/1000.0)) RETURNING client_session_id,expires_at",
     [clientId,identity.actorAccountId,identity.agentId,now+this.ttlMs]);
    if(created.rows?.length!==1)throw fail('gold_agent_client_insert_failed',503);
   }
   // Explicitly replace an earlier owner/team binding for the same session
   // and device. Both tables have separate strict composite FK guards.
   if(g.purpose==='device'){
    await c.query('DELETE FROM lr_agent_team_bindings WHERE client_session_id=$1 AND device_id=$2',
     [clientId,g.device_id]);
    await c.query(
     "INSERT INTO lr_agent_bindings(client_session_id,device_id,grant_id,connection_id,"+
     "pairing_request_id,account_id,grant_purpose) VALUES($1,$2,$3,$4,$5,$6,'device') "+
     "ON CONFLICT(client_session_id,device_id) DO UPDATE SET "+
     "grant_id=EXCLUDED.grant_id,connection_id=EXCLUDED.connection_id,"+
     "pairing_request_id=EXCLUDED.pairing_request_id,last_activity_at=now()",
     [clientId,g.device_id,grant,g.connection_id,request,identity.actorAccountId]);
   }else{
    await c.query('DELETE FROM lr_agent_bindings WHERE client_session_id=$1 AND device_id=$2',
     [clientId,g.device_id]);
    await c.query(
     "INSERT INTO lr_agent_team_bindings(client_session_id,actor_account_id,"+
     "owner_account_id,device_id,connection_id,grant_id,pairing_request_id) "+
     "VALUES($1,$2,$3,$4,$5,$6,$7) "+
     "ON CONFLICT(client_session_id,device_id) DO UPDATE SET "+
     "connection_id=EXCLUDED.connection_id,grant_id=EXCLUDED.grant_id,"+
     "pairing_request_id=EXCLUDED.pairing_request_id,last_activity_at=now()",
     [clientId,identity.actorAccountId,g.owner_account_id,g.device_id,
      g.connection_id,grant,request]);
   }
   const touched=await c.query(
    "UPDATE lr_agent_clients SET default_device_id=$2,last_activity_at=now(),"+
    "expires_at=to_timestamp($3/1000.0) WHERE client_session_id=$1 "+
    "RETURNING expires_at",
    [clientId,g.device_id,now+this.ttlMs]);
   if(touched.rows?.length!==1)throw fail('gold_agent_client_touch_failed',503);
   return {client:{clientSessionId:clientId,agentId:identity.agentId,
    expiresAt:epoch(touched.rows[0].expires_at)},
    device:{deviceId:g.device_id,nodeId:g.node_id,displayName:g.display_name,
     state:g.state,platform:g.platform,architecture:g.architecture},
    grantId:grant,purpose:g.purpose};
  });
 }
 async resolve({agentId,agentProof,clientSessionId,deviceId=null,touch=true}={}){
  const identity=await this.identity({agentId,agentProof}),session=id(clientSessionId);
  const requested=deviceId==null?null:id(deviceId);
  const now=this.now();
  return this.tx(async c=>{
   const sessionRow=await c.query(
    "SELECT ac.client_session_id,ac.account_id,ac.agent_id,ac.default_device_id,"+
    "ac.expires_at,ac.closed_at,actor.status "+
    "FROM lr_agent_clients ac JOIN lr_accounts actor ON actor.account_id=ac.account_id "+
    "WHERE ac.client_session_id=$1 FOR UPDATE OF ac,actor",[session]);
   const client=sessionRow.rows?.[0];
   if(!client||client.closed_at||epoch(client.expires_at)<=now||
      client.status!=='active'||client.account_id!==identity.actorAccountId||
      client.agent_id!==identity.agentId)
    throw fail('gold_agent_client_invalid_or_expired',401);
   const dev=requested||client.default_device_id;
   if(!dev)throw fail('gold_agent_target_required',409);
   // Keep direct and Team paths distinct: a member cannot borrow owner
   // privileges through the historical owner-only binding table.
   const base=
    " JOIN lr_ab_grants g ON g.grant_id=b.grant_id AND g.device_id=b.device_id "+
    "AND g.connection_id=b.connection_id "+
    "JOIN lr_device_connections cn ON cn.connection_id=g.connection_id "+
    "JOIN lr_devices d ON d.device_id=g.device_id "+
    "JOIN lr_accounts owner ON owner.account_id=g.account_id ";
   const rights=
    "AND g.agent_id=$4 AND g.closed_at IS NULL AND g.expires_at>now() "+
    "AND g.absolute_expires_at>now() AND cn.closed_at IS NULL "+
    "AND cn.hard_expires_at>now() AND d.state<>'revoked' "+
    "AND owner.status='active' ";
   const direct=await c.query(
    "SELECT b.grant_id,b.connection_id,b.device_id,b.pairing_request_id,"+
    "d.node_id,d.display_name,d.state,d.platform,d.architecture,"+
    "cn.hard_expires_at,g.expires_at AS grant_expires_at "+
    "FROM lr_agent_bindings b "+base+
    "WHERE b.client_session_id=$1 AND b.device_id=$2 "+
    "AND b.account_id=$3 AND g.account_id=$3 AND g.purpose='device' "+
    rights+"FOR SHARE OF b,g,cn,d,owner",
    [session,dev,identity.actorAccountId,identity.agentId]);
   let binding=direct.rows?.[0],kind='device';
   if(!binding){
    const shared=await c.query(
     "SELECT b.grant_id,b.connection_id,b.device_id,b.pairing_request_id,"+
     "d.node_id,d.display_name,d.state,d.platform,d.architecture,"+
     "cn.hard_expires_at,g.expires_at AS grant_expires_at "+
     "FROM lr_agent_team_bindings b "+base+
     "JOIN lr_ab_team_actor_grants tag ON tag.grant_id=b.grant_id "+
     "JOIN lr_team_members m ON m.team_id=tag.team_id "+
     "AND m.account_id=tag.actor_account_id AND m.state='active' "+
     "JOIN lr_teams t ON t.team_id=tag.team_id "+
     "JOIN lr_team_devices td ON td.team_id=tag.team_id AND td.device_id=b.device_id "+
     "WHERE b.client_session_id=$1 AND b.device_id=$2 "+
     "AND b.actor_account_id=$3 AND tag.actor_account_id=$3 "+
     "AND tag.device_id=b.device_id AND t.owner_account_id=b.owner_account_id "+
     "AND g.account_id=b.owner_account_id AND g.purpose='team-member' "+
     rights+"FOR SHARE OF b,g,cn,d,owner,tag,m,t,td",
     [session,dev,identity.actorAccountId,identity.agentId]);
    binding=shared.rows?.[0];kind='team-member';
   }
   if(!binding)throw fail('gold_agent_binding_expired_or_revoked',403);
   // Listing/querying a device must not silently extend the session lease or
   // change the caller's selected default target.
   if(touch){
    await c.query(
     "UPDATE lr_agent_clients SET last_activity_at=now(),default_device_id=$2,"+
     "expires_at=to_timestamp($3/1000.0) WHERE client_session_id=$1",
     [session,dev,now+this.ttlMs]);
    const table=kind==='device'?'lr_agent_bindings':'lr_agent_team_bindings';
    await c.query('UPDATE '+table+' SET last_activity_at=now() '+
     'WHERE client_session_id=$1 AND device_id=$2',[session,dev]);
   }
   return {binding:{clientSessionId:session,agentId:identity.agentId,
    accountId:identity.actorAccountId,deviceId:dev,connectionId:binding.connection_id,
    grantId:binding.grant_id,pairingRequestId:binding.pairing_request_id||null,
    purpose:kind},device:{deviceId:dev,nodeId:binding.node_id,
    displayName:binding.display_name,state:binding.state,
    platform:binding.platform,architecture:binding.architecture},
    connection:{state:'connected',hardExpiresAt:epoch(binding.hard_expires_at)},
    grant:{grantId:binding.grant_id,expiresAt:epoch(binding.grant_expires_at)}};
  });
 }
 /**
  * Reuse only a still-authorized PostgreSQL client session for this *verified*
  * Agent actor. Never infer identity from query string/accountId parameters.
  */
 async findActive({agentId,agentProof}={}){
  const principal=await this.identity({agentId,agentProof});
  const rows=await this.pool.query(
   "SELECT ac.client_session_id FROM lr_agent_clients ac "+
   "JOIN lr_accounts a ON a.account_id=ac.account_id "+
   "WHERE ac.account_id=$1 AND ac.agent_id=$2 AND ac.closed_at IS NULL "+
   "AND ac.expires_at>now() AND a.status='active' "+
   "ORDER BY ac.last_activity_at DESC,ac.created_at DESC "+
   "LIMIT 32",[principal.actorAccountId,principal.agentId]);
  for(const item of rows.rows||[]){
   try{
    const view=await this.listDevices({agentId,agentProof,
     clientSessionId:item.client_session_id});
    if(view.devices.length)return view;
   }catch(error){
    // A revoked device/Team binding is expected during session recovery;
    // database failures or unexpected verifier errors must never be hidden.
    if(![401,403,404,409].includes(error?.status))throw error;
   }
  }
  throw fail('gold_agent_client_required',401);
 }
 /**
  * Discovery is not authorization. Every returned item passes resolve() with
  * touch=false to recheck owner/actor, grant expiry, connection and Team share.
  * The later tool action must resolve again. Discovery never extends leases.
  */
 async listDevices({agentId,agentProof,clientSessionId}={}){
  const principal=await this.identity({agentId,agentProof});
  const sid=id(clientSessionId),now=this.now();
  const row=await this.pool.query(
   "SELECT ac.client_session_id,ac.default_device_id,ac.expires_at "+
   "FROM lr_agent_clients ac "+
   "JOIN lr_accounts a ON a.account_id=ac.account_id "+
   "WHERE ac.client_session_id=$1 AND ac.account_id=$2 "+
   "AND ac.agent_id=$3 AND ac.closed_at IS NULL AND ac.expires_at>now() "+
   "AND a.status='active'",
   [sid,principal.actorAccountId,principal.agentId]);
  const client=row.rows?.[0];
  if(!client||epoch(client.expires_at)<=now)
   throw fail('gold_agent_client_invalid_or_expired',401);
  const bindings=await this.pool.query(
   "SELECT device_id FROM lr_agent_bindings WHERE client_session_id=$1 "+
   "UNION SELECT device_id FROM lr_agent_team_bindings WHERE client_session_id=$1 "+
   "ORDER BY device_id LIMIT 128",[sid]);
  const devices=[];
  for(const entry of bindings.rows||[]){
   try{
    const valid=await this.resolve({agentId,agentProof,clientSessionId:sid,
     deviceId:entry.device_id,touch:false});
    devices.push({...valid.device,connection:valid.connection,
     grant:valid.grant,purpose:valid.binding.purpose});
   }catch(error){
    if(![401,403,404,409].includes(error?.status))throw error;
   }
  }
  const defaultDeviceId=devices.some(d=>d.deviceId===client.default_device_id)?
   client.default_device_id:(devices.length===1?devices[0].deviceId:null);
  return {client:{clientSessionId:sid,agentId:principal.agentId,
   accountId:principal.actorAccountId,expiresAt:epoch(client.expires_at),
   defaultDeviceId},devices};
 }
}
