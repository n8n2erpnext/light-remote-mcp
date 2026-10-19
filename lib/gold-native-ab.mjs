/**
 * RC50 native A/B request+grant tables. One-time owner B code encrypted,
 * never persisted as plaintext JSONB/file. Existing A/B domain APIs unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const ms=v=>v==null?null:new Date(v).getTime();
const dt=v=>v==null?null:new Date(Number(v));
function loadKey(){
 const root=fs.realpathSync(process.env.LIGHT_REMOTE_GOLD_ROOT||'/nonexistent');
 const file=fs.realpathSync(process.env.LR_GOLD_AB_KEY_FILE||'/nonexistent');
 if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile()||
    (fs.statSync(file).mode&0o077)!==0)throw Error('gold_ab_key_permissions');
 const key=fs.readFileSync(file);
 if(key.length!==32)throw Error('gold_ab_key_must_be_32_bytes');
 return key;
}
function encrypt(value,key){
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const data=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]);
}
function decrypt(data,key){
 if(!Buffer.isBuffer(data)||data.length<29)throw Error('gold_ab_ciphertext_invalid');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(0,12));
 decipher.setAuthTag(data.subarray(12,28));
 return Buffer.concat([decipher.update(data.subarray(28)),decipher.final()]).toString('utf8');
}
export class GoldNativeAB {
 constructor({pool,requests,grants,requestMeta,grantMeta}){
  if(!pool?.connect||!pool?.query)throw Error('gold_ab_pg_required');
  this.pool=pool;this.requests=requests;this.grants=grants;
  this.requestMeta=new Map(requestMeta.map(x=>[x.request_id,x]));
  this.grantMeta=new Map(grantMeta.map(x=>[x.grant_id,x]));
  this.key=null;
 }
 static async open({pool}){
  const [r,g,rm,gm]=await Promise.all([
   pool.query('SELECT * FROM lr_ab_requests'),
   pool.query('SELECT * FROM lr_ab_grants'),
   pool.query('SELECT * FROM lr_gold_ab_request_metadata'),
   pool.query('SELECT * FROM lr_gold_ab_grant_metadata')
  ]);
  return new GoldNativeAB({pool,requests:r.rows,grants:g.rows,requestMeta:rm.rows,grantMeta:gm.rows});
 }
 mount(){
  this.key=loadKey();
  const requests=this.requests.map(r=>{
   const m=this.requestMeta.get(r.request_id)||{};
   return [r.request_id,{
    requestId:r.request_id,accountId:r.account_id,deviceId:r.device_id,
    connectionId:r.connection_id,agentId:r.agent_id,purpose:r.purpose,
    label:m.label||'ChatGPT Plus',userCode:decrypt(r.display_code_ciphertext,this.key),
    pollHash:r.poll_sha256,createdAt:ms(r.created_at),expiresAt:ms(r.expires_at),
    state:r.state,consumedAt:ms(r.consumed_at),deniedAt:m.denied_ms==null?null:Number(m.denied_ms),
    denyReason:m.deny_reason||null,pairingRequired:m.pairing_required===true,pairingId:m.pairing_id||null
   }];
  });
  const grants=this.grants.map(r=>{
   const m=this.grantMeta.get(r.grant_id)||{};
   return [r.grant_id,{
    grantId:r.grant_id,accountId:r.account_id,agentId:r.agent_id,purpose:r.purpose,
    deviceId:r.device_id,connectionId:r.connection_id,
    approvedAt:ms(r.approved_at),lastActivityAt:ms(r.last_activity_at),
    idleGraceMs:r.idle_grace_ms,expiresAt:ms(r.expires_at),
    absoluteExpiresAt:ms(r.absolute_expires_at),
    closedAt:ms(r.closed_at),closeReason:m.close_reason||null
   }];
  });
  return {schemaVersion:1,requests,grants};
 }
 async write({requests=[],grants=[]}={}){
  if(!this.key)throw Error('gold_ab_key_not_mounted');
  const client=await this.pool.connect();let begun=false;
  try{
   await client.query('BEGIN');begun=true;
   for(const [,r] of requests){
    await client.query(`INSERT INTO lr_ab_requests
     (request_id,account_id,device_id,connection_id,agent_id,purpose,poll_sha256,
      display_code_ciphertext,state,created_at,expires_at,consumed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(request_id) DO UPDATE SET
      display_code_ciphertext=EXCLUDED.display_code_ciphertext,state=EXCLUDED.state,
      consumed_at=EXCLUDED.consumed_at`,
     [r.requestId,r.accountId,r.deviceId,r.connectionId,r.agentId??null,r.purpose||'device',r.pollHash,
      encrypt(r.userCode,this.key),r.state,dt(r.createdAt),dt(r.expiresAt),dt(r.consumedAt)]);
    await client.query(`INSERT INTO lr_gold_ab_request_metadata
     (request_id,label,pairing_required,pairing_id,denied_ms,deny_reason)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO UPDATE SET
      label=EXCLUDED.label,pairing_required=EXCLUDED.pairing_required,
      pairing_id=EXCLUDED.pairing_id,denied_ms=EXCLUDED.denied_ms,deny_reason=EXCLUDED.deny_reason`,
     [r.requestId,r.label||'ChatGPT Plus',r.pairingRequired===true,
      r.pairingId??null,r.deniedAt??null,r.denyReason??null]);
   }
   for(const [,r]of grants){
    await client.query(`INSERT INTO lr_ab_grants
     (grant_id,account_id,device_id,connection_id,agent_id,purpose,approved_at,
      last_activity_at,idle_grace_ms,expires_at,absolute_expires_at,closed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(grant_id) DO UPDATE SET
      last_activity_at=EXCLUDED.last_activity_at,idle_grace_ms=EXCLUDED.idle_grace_ms,
      expires_at=EXCLUDED.expires_at,closed_at=EXCLUDED.closed_at`,
     [r.grantId,r.accountId,r.deviceId,r.connectionId,r.agentId??null,r.purpose||'device',
      dt(r.approvedAt),dt(r.lastActivityAt),r.idleGraceMs,dt(r.expiresAt),
      dt(r.absoluteExpiresAt),dt(r.closedAt)]);
    await client.query(`INSERT INTO lr_gold_ab_grant_metadata(grant_id,close_reason)
      VALUES($1,$2) ON CONFLICT(grant_id) DO UPDATE SET close_reason=EXCLUDED.close_reason`,
      [r.grantId,r.closeReason??null]);
   }
   await client.query('DELETE FROM lr_ab_requests WHERE NOT(request_id=ANY($1::text[]))',
    [requests.map(([,r])=>r.requestId)]);
   await client.query('DELETE FROM lr_ab_grants WHERE NOT(grant_id=ANY($1::text[]))',
    [grants.map(([,r])=>r.grantId)]);
   await client.query('COMMIT');begun=false;
  }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
 }
}
