/**
 * Relational Gold Core authority: PostgreSQL 17 business source of truth.
 * This source is not activated until legacy API routes are fully migrated.
 * Proof callbacks MUST be bound to trusted verifier implementations.
 */
import crypto from 'node:crypto';
const idPattern=/^[A-Za-z0-9._:-]{1,128}$/;
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const purposes=new Set(['authorization_code','refresh','resume','magic','email_verify','password_reset']);
const err=(code,status=403)=>Object.assign(new Error(code),{code,status});
const id=v=>{const s=String(v||'');if(!idPattern.test(s))throw err('gold_core_invalid_id',400);return s};
const sha=v=>crypto.createHash('sha256').update(String(v||'')).digest('hex');
const token=()=>crypto.randomBytes(32).toString('base64url');
const ms=v=>v==null?null:new Date(v).getTime();
const ttl=(n,min,max)=>{if(!Number.isSafeInteger(n)||n<min||n>max)throw err('gold_core_invalid_ttl',400);return n};
const same=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y)};
const passHash=plain=>{const salt=crypto.randomBytes(16);
 return 'scrypt$'+salt.toString('base64url')+'$'+crypto.scryptSync(plain,salt,32).toString('base64url')};
const passVerify=(plain,encoded)=>{const [alg,salt,hash]=String(encoded||'').split('$');
 if(alg!=='scrypt'||!salt||!hash)return false;
 const expected=Buffer.from(hash,'base64url');return expected.length===32&&
 crypto.timingSafeEqual(expected,crypto.scryptSync(plain,Buffer.from(salt,'base64url'),32))};
const encrypt=(plain,key)=>{const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
 return Buffer.concat([nonce,cipher.getAuthTag(),cipher.update(plain,'utf8'),cipher.final()])};
const decrypt=(payload,key)=>{const b=Buffer.from(payload||[]);if(b.length<29)throw err('gold_ab_cipher_corrupt',503);
 const cipher=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(0,12));
 cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8')};
export class GoldPgCoreAuthority{
 constructor({pool,now=()=>Date.now(),verifyIdentityProof,verifyDeviceProof,
  verifyAgentPrincipal,verifyWallApproval,verifyPaddleSignature,pairingEncryptionKey,
  planDeviceCap={free:2,pro:10,vip:30}}={}){
  if(!pool?.connect||!pool?.query)throw Error('gold_core_pg_pool_required');
  for(const [key,value] of Object.entries({verifyIdentityProof,verifyDeviceProof,
    verifyAgentPrincipal,verifyWallApproval,verifyPaddleSignature})){
   if(typeof value!=='function')throw Error('gold_core_trusted_verifier_required_'+key);
  }
  if(!Buffer.isBuffer(pairingEncryptionKey)||pairingEncryptionKey.length!==32)
   throw Error('gold_core_pairing_key_required');
  Object.assign(this,{pool,now,verifyIdentityProof,verifyDeviceProof,
   verifyAgentPrincipal,verifyWallApproval,verifyPaddleSignature,pairingEncryptionKey,planDeviceCap});
 }
 async tx(fn){
  const c=await this.pool.connect();let started=false;
  try{
   await c.query('BEGIN');started=true;const result=await fn(c);
   await c.query('COMMIT');started=false;return result;
  }catch(e){if(started)await c.query('ROLLBACK').catch(()=>{});throw e}
  finally{c.release()}
 }
 async registerVerifiedAccount({accountId,email,password,proof}={}){
  const account=id(accountId),mail=String(email||'').trim().toLowerCase();
  if(!emailPattern.test(mail)||mail.length>254||typeof password!=='string'||password.length<10||password.length>1024)
   throw err('gold_account_signup_invalid',400);
  return this.tx(async c=>{
   // Challenge consumption and account insert must share the transaction.
   if(await this.verifyIdentityProof({purpose:'verified_email',accountId:account,
     email:mail,proof,client:c})!==true)
    throw err('gold_verified_email_proof_required');
   const r=await c.query(
    "INSERT INTO lr_accounts(account_id,email,password_hash,email_verified,password_enabled,plan,status) "+
    "VALUES($1,$2,$3,true,true,'free','active') ON CONFLICT DO NOTHING "+
    "RETURNING account_id,email,plan,status",
    [account,mail,passHash(password)]);
   if(r.rows?.length!==1)throw err('gold_account_exists',409);
   return r.rows[0];
  });
 }
 async login({email,password,sessionTtlMs=604800000}={}){
  const mail=String(email||'').trim().toLowerCase();
  if(!emailPattern.test(mail)||typeof password!=='string')throw err('gold_login_invalid',401);
  ttl(sessionTtlMs,1800000,2592000000);
  return this.tx(async c=>{
   const result=await c.query(
    "SELECT account_id,email,plan,status,password_hash,email_verified,password_enabled "+
    "FROM lr_accounts WHERE lower(email)=lower($1) FOR UPDATE",[mail]);
   const a=result.rows?.[0];
   if(!a||!passVerify(password,a.password_hash))throw err('gold_login_invalid',401);
   if(a.status!=='active'||a.email_verified!==true||a.password_enabled!==true)
    throw err('gold_login_account_blocked');
   const raw=token(),sessionId='as_'+crypto.randomUUID(),expiration=this.now()+sessionTtlMs;
   await c.query(
    "INSERT INTO lr_sessions(session_id,account_id,token_sha256,expires_at) "+
    "VALUES($1,$2,$3,to_timestamp($4/1000.0))",
    [sessionId,a.account_id,sha(raw),expiration]);
   await c.query('UPDATE lr_accounts SET last_login_at=now(),updated_at=now() WHERE account_id=$1',
    [a.account_id]);
   return {token:raw,account:{accountId:a.account_id,email:a.email,plan:a.plan},
    sessionId,expiresAt:expiration};
  });
 }
 async authenticate(raw){
  if(typeof raw!=='string'||raw.length<20)throw err('gold_auth_invalid_session',401);
  const r=await this.pool.query(
   "SELECT s.session_id,s.account_id,s.expires_at,a.email,a.plan "+
   "FROM lr_sessions s JOIN lr_accounts a ON a.account_id=s.account_id "+
   "WHERE s.token_sha256=$1 AND s.revoked_at IS NULL AND s.expires_at>now() "+
   "AND a.status='active' AND a.email_verified=true",[sha(raw)]);
  if(!r.rows?.length)throw err('gold_auth_invalid_session',401);
  const a=r.rows[0];return{accountId:a.account_id,sessionId:a.session_id,
   email:a.email,plan:a.plan,expiresAt:ms(a.expires_at)};
 }
 async logout(raw){
  if(typeof raw!=='string'||raw.length<20)throw err('gold_auth_invalid_session',401);
  const r=await this.pool.query(
   "UPDATE lr_sessions SET revoked_at=now(),revoked_reason='logout' "+
   "WHERE token_sha256=$1 AND revoked_at IS NULL RETURNING session_id",[sha(raw)]);
  return {loggedOut:r.rows?.length===1};
 }
 async disableAccount({accountId,actorAccountId,proof}={}){
  const owner=id(accountId),actor=id(actorAccountId);
  if(await this.verifyIdentityProof({purpose:'admin_disable_account',
     accountId:owner,actorAccountId:actor,proof})!==true)
   throw err('gold_admin_authority_required');
  return this.tx(async c=>{
   const found=await c.query('SELECT account_id FROM lr_accounts WHERE account_id=$1 FOR UPDATE',[owner]);
   if(!found.rows?.length)throw err('gold_account_not_found',404);
   await c.query("UPDATE lr_accounts SET status='admin_disabled',disabled_at=now(),updated_at=now() WHERE account_id=$1",[owner]);
   const revoked=await c.query(
    "UPDATE lr_sessions SET revoked_at=now(),revoked_reason='account_disabled' "+
    "WHERE account_id=$1 AND revoked_at IS NULL RETURNING session_id",[owner]);
   await c.query("UPDATE lr_ab_requests SET state='denied',consumed_at=now() "+
    "WHERE account_id=$1 AND state='pending'",[owner]);
   await c.query("UPDATE lr_ab_grants SET closed_at=now() WHERE account_id=$1 AND closed_at IS NULL",[owner]);
   await c.query("UPDATE lr_device_connections SET closed_at=now(),close_reason='account_disabled' "+
    "WHERE account_id=$1 AND closed_at IS NULL",[owner]);
   await c.query('DELETE FROM lr_ab_team_actor_grants WHERE actor_account_id=$1',[owner]);
   return {accountId:owner,revokedSessions:revoked.rows?.length||0,status:'admin_disabled'};
  });
 }
 async registerDevice({sessionToken,deviceId,nodeId,publicIdentityKey,
  displayName='',platform='unknown',architecture='unknown',agentVersion='unknown',proof}={}){
  const principal=await this.authenticate(sessionToken),dev=id(deviceId),node=id(nodeId);
  if(!publicIdentityKey||String(publicIdentityKey).length>4096)
   throw err('gold_device_key_invalid',400);
  if(await this.verifyDeviceProof({accountId:principal.accountId,deviceId:dev,nodeId:node,
    publicIdentityKey,proof})!==true)throw err('gold_device_identity_proof_required');
  return this.tx(async c=>{
   const owner=await c.query('SELECT status FROM lr_accounts WHERE account_id=$1 FOR SHARE',[principal.accountId]);
   if(owner.rows?.[0]?.status!=='active')throw err('gold_device_owner_inactive');
   const prior=await c.query(
    'SELECT owner_account_id,public_identity_key,state FROM lr_devices WHERE device_id=$1 FOR UPDATE',[dev]);
   const existing=prior.rows?.[0];
   if(existing&&(existing.owner_account_id!==principal.accountId||
    existing.public_identity_key!==publicIdentityKey||existing.state==='revoked'))
    throw err('gold_device_identity_conflict',409);
   const result=await c.query(
    "INSERT INTO lr_devices(device_id,owner_account_id,state,node_id,display_name,"+
    "public_identity_key,platform,architecture,agent_version,last_seen_at) "+
    "VALUES($1,$2,'online',$3,$4,$5,$6,$7,$8,now()) "+
    "ON CONFLICT(device_id) DO UPDATE SET state='online',last_seen_at=now(),updated_at=now(),"+
    "display_name=EXCLUDED.display_name,platform=EXCLUDED.platform,"+
    "architecture=EXCLUDED.architecture,agent_version=EXCLUDED.agent_version "+
    "RETURNING device_id,owner_account_id,node_id,state",
    [dev,principal.accountId,node,String(displayName||dev).slice(0,120),
     String(publicIdentityKey),String(platform).slice(0,40),
     String(architecture).slice(0,40),String(agentVersion).slice(0,40)]);
   return result.rows[0];
  });
 }
 async connectDevice({sessionToken,deviceId,leaseMs=86400000,reconnectGraceMs=3600000}={}){
  const owner=await this.authenticate(sessionToken),dev=id(deviceId);
  ttl(leaseMs,900000,86400000);ttl(reconnectGraceMs,900000,3600000);
  return this.tx(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['gold:connect:'+owner.accountId]);
   const r=await c.query(
    "SELECT d.device_id,d.state,a.plan,a.status FROM lr_devices d "+
    "JOIN lr_accounts a ON a.account_id=d.owner_account_id "+
    "WHERE d.device_id=$1 AND d.owner_account_id=$2 FOR UPDATE",
    [dev,owner.accountId]);
   const row=r.rows?.[0];
   if(!row||row.state==='revoked'||row.status!=='active')
    throw err('gold_connection_device_invalid');
   const prior=await c.query(
    "SELECT connection_id,hard_expires_at FROM lr_device_connections "+
    "WHERE account_id=$1 AND device_id=$2 AND closed_at IS NULL "+
    "AND hard_expires_at>now() ORDER BY connected_at DESC LIMIT 1 FOR UPDATE",
    [owner.accountId,dev]);
   if(prior.rows?.length)return {connectionId:prior.rows[0].connection_id,
    deviceId:dev,accountId:owner.accountId,
    expiresAt:ms(prior.rows[0].hard_expires_at),reused:true};
   const cnt=await c.query(
    "SELECT COUNT(DISTINCT device_id)::integer AS count FROM lr_device_connections "+
    "WHERE account_id=$1 AND closed_at IS NULL AND hard_expires_at>now()",
    [owner.accountId]);
   if(Number(cnt.rows?.[0]?.count||0)>=Number(this.planDeviceCap[row.plan]||0))
    throw err('gold_connection_plan_cap',429);
   const conn='conn_'+crypto.randomUUID(),expiresAt=this.now()+leaseMs;
   await c.query(
    "INSERT INTO lr_device_connections(connection_id,device_id,account_id,plan,"+
    "hard_expires_at,reconnect_grace_ms) VALUES($1,$2,$3,$4,to_timestamp($5/1000.0),$6)",
    [conn,dev,owner.accountId,row.plan,expiresAt,reconnectGraceMs]);
   return {connectionId:conn,deviceId:dev,accountId:owner.accountId,expiresAt};
  });
 }
 async requestPairing({connectionId,agentId,agentProof,purpose='device',ttlMs=600000}={}){
  const conn=id(connectionId),agent=id(agentId);
  ttl(ttlMs,60000,600000);
  if(!['device','team-member'].includes(purpose))throw err('gold_ab_purpose_invalid',400);
  const actor=await this.verifyAgentPrincipal({agentId:agent,agentProof});
  if(!actor?.accountId)throw err('gold_ab_agent_proof_required',401);
  return this.tx(async c=>{
   const existing=await c.query(
    "SELECT cn.connection_id,cn.device_id,cn.account_id,cn.hard_expires_at,"+
    "a.status,d.state AS device_state FROM lr_device_connections cn "+
    "JOIN lr_accounts a ON a.account_id=cn.account_id "+
    "JOIN lr_devices d ON d.device_id=cn.device_id "+
    "WHERE cn.connection_id=$1 AND cn.closed_at IS NULL AND cn.hard_expires_at>now() FOR UPDATE",
    [conn]);
   const row=existing.rows?.[0];
   if(!row||row.status!=='active'||row.device_state==='revoked')
    throw err('gold_ab_connection_invalid');
   if(purpose==='device'&&actor.accountId!==row.account_id)
    throw err('gold_ab_account_mismatch');
   if(purpose==='team-member'){
    const member=await c.query(
     "SELECT t.team_id FROM lr_teams t "+
     "JOIN lr_team_members m ON m.team_id=t.team_id AND m.state='active' "+
     "JOIN lr_team_devices td ON td.team_id=t.team_id "+
     "WHERE t.owner_account_id=$1 AND m.account_id=$2 AND td.device_id=$3",
     [row.account_id,actor.accountId,row.device_id]);
    if(!member.rows?.length)throw err('gold_ab_team_denied');
   }
   const requestId='ab_'+crypto.randomUUID(),pollToken=token(),
    raw=crypto.randomBytes(5).toString('hex').toUpperCase(),
    code=raw.slice(0,5)+'-'+raw.slice(5);
   const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',
    this.pairingEncryptionKey,nonce);
   const sealed=Buffer.concat([nonce,cipher.update(code,'utf8'),cipher.final(),cipher.getAuthTag()]);
   const created=await c.query(
    "INSERT INTO lr_ab_requests(request_id,account_id,device_id,connection_id,"+
    "agent_id,purpose,actor_account_id,poll_sha256,display_code_ciphertext,expires_at) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()+($10::integer * interval '1 millisecond')) "+
    "RETURNING expires_at",
    [requestId,row.account_id,row.device_id,conn,agent,purpose,
     actor.accountId,sha(pollToken),sealed,ttlMs]);
   if(created.rows?.length!==1)throw Error('gold_ab_request_insert_failed');
   return {requestId,pollToken,approvalCode:code,expiresAt:ms(created.rows[0].expires_at)};
  });
 }
 async approvePairing({requestId,approvalCode,wallContext}={}){
  const request=id(requestId);
  if(await this.verifyWallApproval({requestId:request,wallContext})!==true)
   throw err('gold_ab_wall_approval_required');
  const approved=await this.tx(async c=>{
   const found=await c.query(
    "SELECT r.*,cn.hard_expires_at,cn.closed_at,d.state AS device_state,"+
    "a.status AS account_status FROM lr_ab_requests r "+
    "JOIN lr_device_connections cn ON cn.connection_id=r.connection_id "+
    "JOIN lr_devices d ON d.device_id=r.device_id "+
    "JOIN lr_accounts a ON a.account_id=r.account_id WHERE r.request_id=$1 FOR UPDATE",
    [request]);
   const row=found.rows?.[0];
   if(!row||row.state!=='pending'||ms(row.expires_at)<=this.now()||
    row.closed_at||ms(row.hard_expires_at)<=this.now()||
    row.device_state==='revoked'||row.account_status!=='active')
    throw err('gold_ab_expired_or_consumed',409);
   const buf=Buffer.from(row.display_code_ciphertext||[]);
   if(buf.length<29)throw err('gold_ab_cipher_invalid',503);
   const decipher=crypto.createDecipheriv('aes-256-gcm',this.pairingEncryptionKey,buf.subarray(0,12));
   decipher.setAuthTag(buf.subarray(-16));
   const secret=Buffer.concat([decipher.update(buf.subarray(12,-16)),decipher.final()]).toString('utf8');
   if(!same(secret,String(approvalCode||'').toUpperCase().trim())){
    await c.query(
     "UPDATE lr_ab_requests SET failed_attempts=failed_attempts+1,"+
     "state=CASE WHEN failed_attempts>=4 THEN 'denied' ELSE state END WHERE request_id=$1",
     [request]);
    return {approved:false,reason:'gold_ab_code_invalid'};
   }
   const grant='grant_'+crypto.randomUUID(),now=this.now(),idle=3600000,absolute=now+86400000;
   await c.query(
    "INSERT INTO lr_ab_grants(grant_id,account_id,device_id,connection_id,"+
    "agent_id,purpose,approved_at,last_activity_at,idle_grace_ms,expires_at,absolute_expires_at) "+
    "VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7/1000.0),to_timestamp($7/1000.0),"+
    "$8,to_timestamp($9/1000.0),to_timestamp($10/1000.0))",
    [grant,row.account_id,row.device_id,row.connection_id,row.agent_id,row.purpose,
     now,idle,Math.min(ms(row.hard_expires_at),now+idle),absolute]);
   if(row.purpose==='team-member'){
    // The Wall principal is independently verified: never trust a request
    // body's member account ID.
    const actor=await this.verifyAgentPrincipal({agentId:row.agent_id,
     agentProof:wallContext?.agentProof});
    const member=await c.query(
     "SELECT t.team_id FROM lr_teams t JOIN lr_team_members m "+
     "ON m.team_id=t.team_id AND m.state='active' "+
     "JOIN lr_team_devices td ON td.team_id=t.team_id "+
     "WHERE t.owner_account_id=$1 AND m.account_id=$2 AND td.device_id=$3",
     [row.account_id,actor?.accountId||'',row.device_id]);
    if(actor?.accountId!==row.actor_account_id||!member.rows?.length)
     throw err('gold_ab_team_membership_revoked');
    await c.query(
     "INSERT INTO lr_ab_team_actor_grants(grant_id,team_id,actor_account_id,device_id) "+
     "VALUES($1,$2,$3,$4)",
     [grant,member.rows[0].team_id,actor.accountId,row.device_id]);
   }
   const update=await c.query(
    "UPDATE lr_ab_requests SET state='approved',consumed_at=now(),"+
    "display_code_ciphertext=NULL,approved_grant_id=$2 WHERE request_id=$1 AND state='pending' RETURNING request_id",
    [request,grant]);
   if(update.rows?.length!==1)throw err('gold_ab_race_lost',409);
   return {approved:true,grantId:grant,deviceId:row.device_id,
    expiresAt:Math.min(ms(row.hard_expires_at),now+idle)};
  });
  if(!approved.approved)throw err(approved.reason,401);
  return approved;
 }
 async pollPairing({pollToken,agentId,agentProof}={}){
  const agent=id(agentId);
  if(typeof pollToken!=='string'||!/^[-_A-Za-z0-9]{40,256}$/.test(pollToken))
   throw err('gold_ab_poll_token_invalid',401);
  const actor=await this.verifyAgentPrincipal({agentId:agent,agentProof});
  if(!actor?.accountId)throw err('gold_ab_agent_proof_required',401);
  const result=await this.pool.query(
   "SELECT r.state,r.account_id,r.actor_account_id,r.device_id,r.purpose,r.expires_at,"+
   "r.approved_grant_id,g.closed_at AS grant_closed_at,g.expires_at AS grant_expires_at,"+
   "g.absolute_expires_at,cn.hard_expires_at,cn.closed_at AS connection_closed_at,"+
   "d.state AS device_state,a.status AS owner_status,"+
   "tag.actor_account_id,tm.state AS member_state,td.device_id AS shared_device "+
   "FROM lr_ab_requests r "+
   "JOIN lr_accounts a ON a.account_id=r.account_id "+
   "JOIN lr_device_connections cn ON cn.connection_id=r.connection_id "+
   "JOIN lr_devices d ON d.device_id=r.device_id "+
   "LEFT JOIN lr_ab_grants g ON g.grant_id=r.approved_grant_id "+
   "LEFT JOIN lr_ab_team_actor_grants tag ON tag.grant_id=g.grant_id "+
   "LEFT JOIN lr_team_members tm ON tm.team_id=tag.team_id "+
   "AND tm.account_id=tag.actor_account_id "+
   "LEFT JOIN lr_team_devices td ON td.team_id=tag.team_id AND td.device_id=r.device_id "+
   "WHERE r.poll_sha256=$1 AND r.agent_id=$2",
   [sha(pollToken),agent]);
  const row=result.rows?.[0];
  if(!row||row.owner_status!=='active'||row.device_state==='revoked'||
   row.connection_closed_at||ms(row.hard_expires_at)<=this.now())
   throw err('gold_ab_poll_inactive_or_unknown',404);
  if(row.actor_account_id!==actor.accountId)
   throw err('gold_ab_poll_account_mismatch',403);
  if(row.purpose==='team-member'&&row.state==='approved'&&
   (row.member_state!=='active'||!row.shared_device))
   throw err('gold_ab_poll_team_revoked',403);
  if(row.state==='pending'&&ms(row.expires_at)>this.now())
   return {state:'pending'};
  if(row.state!=='approved'||!row.approved_grant_id||row.grant_closed_at||
   ms(row.grant_expires_at)<=this.now()||ms(row.absolute_expires_at)<=this.now())
   return {state:'closed'};
  return {state:'approved',grantId:row.approved_grant_id,deviceId:row.device_id,
   expiresAt:Math.min(ms(row.grant_expires_at),ms(row.absolute_expires_at),
    ms(row.hard_expires_at))};
 }
 async authorizeGrant({grantId,actorAccountId,deviceId,connectionId,agentId}={}){
  const [grant,actor,dev,conn,agent]=
   [grantId,actorAccountId,deviceId,connectionId,agentId].map(id);
  const result=await this.pool.query(
   "SELECT g.account_id AS owner,g.purpose,tag.actor_account_id,"+
   "tm.state AS team_state,td.device_id AS shared_device FROM lr_ab_grants g "+
   "JOIN lr_device_connections cn ON cn.connection_id=g.connection_id "+
   "JOIN lr_devices d ON d.device_id=g.device_id "+
   "JOIN lr_accounts owner ON owner.account_id=g.account_id "+
   "JOIN lr_accounts actor ON actor.account_id=$5 AND actor.status='active' "+
   "LEFT JOIN lr_ab_team_actor_grants tag ON tag.grant_id=g.grant_id "+
   "LEFT JOIN lr_team_members tm ON tm.team_id=tag.team_id AND tm.account_id=tag.actor_account_id "+
   "LEFT JOIN lr_team_devices td ON td.team_id=tag.team_id AND td.device_id=g.device_id "+
   "WHERE g.grant_id=$1 AND g.device_id=$2 AND g.connection_id=$3 AND g.agent_id=$4 "+
   "AND g.closed_at IS NULL AND g.expires_at>now() AND g.absolute_expires_at>now() "+
   "AND cn.closed_at IS NULL AND cn.hard_expires_at>now() "+
   "AND owner.status='active' AND d.state<>'revoked'",
   [grant,dev,conn,agent,actor]);
  const row=result.rows?.[0];
  if(!row||row.purpose==='device'&&row.owner!==actor||
   row.purpose==='team-member'&&(
     row.actor_account_id!==actor||row.team_state!=='active'||!row.shared_device))
   throw err('gold_ab_grant_invalid_or_revoked');
  return {allowed:true,grantId:grant,actorAccountId:actor,deviceId:dev};
 }
 async authorizeTeam({teamId,actorAccountId,deviceId}={}){
  const [team,actor,dev]=[teamId,actorAccountId,deviceId].map(id);
  const r=await this.pool.query(
   "SELECT t.team_id FROM lr_teams t JOIN lr_team_members m "+
   "ON m.team_id=t.team_id AND m.state='active' "+
   "JOIN lr_team_devices td ON td.team_id=t.team_id "+
   "JOIN lr_accounts a ON a.account_id=m.account_id AND a.status='active' "+
   "WHERE t.team_id=$1 AND m.account_id=$2 AND td.device_id=$3",
   [team,actor,dev]);
  if(!r.rows?.length)throw err('gold_team_device_access_denied');
  return {allowed:true,teamId:team,actorAccountId:actor,deviceId:dev};
 }
 async issueOAuth({purpose,accountId,clientId=null,ttlMs=300000}={}){
  if(!purposes.has(purpose))throw err('gold_oauth_purpose_invalid',400);
  const account=id(accountId),limit=ttl(ttlMs,60000,3600000),raw=token();
  const result=await this.pool.query(
   "INSERT INTO lr_oauth_one_time(token_sha256,purpose,account_id,client_id,expires_at) "+
   "SELECT $1,$2,account_id,$4,to_timestamp($5/1000.0) FROM lr_accounts "+
   "WHERE account_id=$3 AND status='active' RETURNING token_sha256",
   [sha(raw),purpose,account,clientId,this.now()+limit]);
  if(result.rows?.length!==1)throw err('gold_oauth_account_invalid');
  return {token:raw,expiresAt:this.now()+limit};
 }
 async consumeOAuth({purpose,token:raw,clientId=null}={}){
  if(!purposes.has(purpose)||typeof raw!=='string'||raw.length<20)
   throw err('gold_oauth_invalid',400);
  const r=await this.pool.query(
   "UPDATE lr_oauth_one_time t SET consumed_at=now() "+
   "FROM lr_accounts a WHERE t.account_id=a.account_id "+
   "AND t.token_sha256=$1 AND t.purpose=$2 AND t.client_id IS NOT DISTINCT FROM $3 "+
   "AND t.consumed_at IS NULL AND t.expires_at>now() AND a.status='active' "+
   "RETURNING t.account_id",
   [sha(raw),purpose,clientId]);
  if(r.rows?.length!==1)throw err('gold_oauth_expired_or_replayed',401);
  return {accountId:r.rows[0].account_id};
 }
 async ingestPaddle({payload,signature}={}){
  // Signature callback must validate raw, untampered webhook bytes and Paddle
  // event timestamp. It returns trusted extracted fields or null.
  const e=await this.verifyPaddleSignature({payload,signature});
  if(!e)throw err('gold_paddle_signature_invalid',401);
  const owner=id(e.ownerAccountId),event=id(e.eventId);
  if(!['payment','refund','subscription_update','entitlement_grant','entitlement_revoke'].includes(e.kind))
   throw err('gold_paddle_event_kind_invalid',400);
  if(!e.providerEventId||String(e.providerEventId).length>160)
   throw err('gold_paddle_provider_event_invalid',400);
  return this.tx(async c=>{
   const prior=await c.query(
    "SELECT event_id,owner_account_id,kind FROM lr_billing_events "+
    "WHERE provider='paddle' AND provider_event_id=$1 FOR UPDATE",[e.providerEventId]);
   if(prior.rows?.length){
    if(prior.rows[0].owner_account_id!==owner||prior.rows[0].kind!==e.kind)
     throw err('gold_paddle_event_conflict',409);
    return {recorded:false,duplicate:true};
   }
   const account=await c.query(
    'SELECT account_id FROM lr_accounts WHERE account_id=$1 FOR UPDATE',[owner]);
   if(!account.rows?.length)throw err('gold_paddle_owner_not_found',404);
   const amount=e.amountMinor==null?null:Number(e.amountMinor);
   if(amount!==null&&(!Number.isSafeInteger(amount)||amount<0))
    throw err('gold_paddle_amount_invalid',400);
   const saved=await c.query(
    "INSERT INTO lr_billing_events(event_id,owner_account_id,provider,"+
    "external_transaction_id,kind,amount_minor,currency,provider_event_id) "+
    "VALUES($1,$2,'paddle',$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING event_id",
    [event,owner,e.transactionId||null,e.kind,amount,e.currency||null,e.providerEventId]);
   if(saved.rows?.length!==1){
    const concurrent=await c.query(
     "SELECT owner_account_id,kind FROM lr_billing_events "+
     "WHERE provider='paddle' AND provider_event_id=$1",
     [e.providerEventId]);
    const row=concurrent.rows?.[0];
    if(row?.owner_account_id===owner&&row.kind===e.kind)
     return {recorded:false,duplicate:true};
    throw err('gold_paddle_concurrent_conflict',409);
   }
   // Entitlements are NOT granted by generic payment events. A separate,
   // verified subscription decision and reversible entitlement ledger is required.
   return {recorded:true,duplicate:false};
  });
 }
}
