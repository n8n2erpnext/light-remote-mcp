// Gold P2-I2 V2 pending protocol, source candidate. NOT mounted on live routes.
// Redis8 EVAL is the atomic authority, server clock controls expiry.
// Caller MUST authenticate OAuth actor/owner and active device connection/policy.
import crypto from 'node:crypto';
export const AB_V2_TTL_MS=300000;
export const AB_V2_SHORT_RE=/^[0-9A-HJKMNP-TV-Z]{6}$/;
export const AB_V2_A_RE=/^[0-9A-HJKMNP-TV-Z]{6}-[0-9A-HJKMNP-TV-Z]{5}$/;
export const AB_V2_B_RE=/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const ABC='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const B_ABC='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ID_RE=/^[A-Za-z0-9._:-]{1,160}$/;
const valid=(v,k)=>{if(typeof v!=='string'||!ID_RE.test(v))throw Error('abv2_invalid_'+k);return v};
const randomCode=n=>Array.from({length:n},()=>ABC[crypto.randomInt(ABC.length)]).join('');
const mkB=()=>{const v=Array.from({length:8},()=>B_ABC[crypto.randomInt(B_ABC.length)]).join('');return v.slice(0,4)+'-'+v.slice(4)};
const fingerprint=(key,v)=>crypto.createHmac('sha256',key).update(v).digest('hex');
function normalizeB(v){const s=String(v||'').toUpperCase().replace(/-/g,'');
 if(!/^[A-HJ-NP-Z2-9]{8}$/.test(s))throw Error('abv2_b_format_invalid');
 return s.slice(0,4)+'-'+s.slice(4);}
function encrypt(v,key,aad){
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv);
 c.setAAD(Buffer.from(aad));
 const out=Buffer.concat([c.update(v,'utf8'),c.final()]);
 return {iv:iv.toString('base64url'),ct:out.toString('base64url'),tag:c.getAuthTag().toString('base64url')};
}
function decrypt(v,key,aad){
 const c=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(v.iv,'base64url'));
 c.setAAD(Buffer.from(aad));c.setAuthTag(Buffer.from(v.tag,'base64url'));
 return Buffer.concat([c.update(Buffer.from(v.ct,'base64url')),c.final()]).toString('utf8');
}
// Lua source is shipped only for explicit Redis EVAL. State mutations and
// request-identity comparisons occur in a single atomic Redis transaction.
const LUA=[
 "local op=ARGV[1]",
 "local p=cjson.decode(ARGV[2])",
 "local t=redis.call('TIME')",
 "local now=t[1]*1000+math.floor(t[2]/1000)",
 "local k=KEYS[1]",
 "if op=='issue' then",
 " if redis.call('EXISTS',k)==1 then",
 "  local old=cjson.decode(redis.call('GET',k))",
 "  if old.owner~=p.owner or old.actor~=p.actor or old.agent~=p.agent or old.client~=p.client or old.device~=p.device or old.connection~=p.connection or old.shortId~=p.shortId or (old.purpose or 'device')~=(p.purpose or 'device') then return redis.error_reply('abv2_id_conflict') end",
 "  return cjson.encode({state=old.state,requestId=old.requestId,attempt=old.attempt,expiresAt=old.expiresAt,reused=true})",
 " end",
 " local aa=tonumber(redis.call('GET',KEYS[2]) or '0')",
 " local dd=tonumber(redis.call('GET',KEYS[3]) or '0')",
 " if aa>=4 or dd>=12 then return redis.error_reply('abv2_issue_rate_limited') end",
 " p.createdAt=now;p.expiresAt=now+300000;p.rotatedAt=now",
 " if not redis.call('SET',k,cjson.encode(p),'PX',900000,'NX') then return redis.error_reply('abv2_id_conflict') end",
 " redis.call('ZADD',KEYS[4],p.expiresAt,p.requestId)",
 " redis.call('PEXPIRE',KEYS[4],900000)",
 " redis.call('INCR',KEYS[2]);if aa==0 then redis.call('PEXPIRE',KEYS[2],300000) end",
 " redis.call('INCR',KEYS[3]);if dd==0 then redis.call('PEXPIRE',KEYS[3],300000) end",
 " return cjson.encode({state='pending',requestId=p.requestId,attempt=1,expiresAt=p.expiresAt})",
 "end",
 "local raw=redis.call('GET',k)",
 "if not raw then return redis.error_reply('abv2_not_found') end",
 "local r=cjson.decode(raw)",
 "if op=='agent' then",
 " if r.actor~=p.actor or r.agent~=p.agent or r.client~=p.client or r.connection~=p.connection then return redis.error_reply('abv2_agent_scope_denied') end",
 "else",
 " if r.owner~=p.owner or r.device~=p.device or r.connection~=p.connection then return redis.error_reply('abv2_owner_scope_denied') end",
 "end",
 "if r.state=='pending' and now>=r.expiresAt then",
 " r.state='expired';r.box=cjson.null;r.codeHash=cjson.null",
 " redis.call('SET',k,cjson.encode(r),'KEEPTTL')",
 " redis.call('ZREM',r.indexKey,r.requestId)",
 "end",
 "if op=='agent' then",
 " return cjson.encode({state=r.state,requestId=r.requestId,attempt=r.attempt,expiresAt=r.expiresAt,box=r.state=='pending' and r.box or cjson.null})",
 "end",
 "if op=='wall' then",
 " return cjson.encode({state=r.state,requestId=r.requestId,attempt=r.attempt,expiresAt=r.expiresAt,aCode=r.state=='pending' and (r.shortId..'-'..r.suffix) or cjson.null,requester=r.actor,purpose=r.purpose or 'device'})",
 "end",
 "if op=='grant_commit' then",
 " if r.state~='approved' and r.state~='granted' then return redis.error_reply('abv2_b_not_verified') end",
 " if r.approvedAt~=p.approvedAt or r.attempt~=p.attempt or p.grantId~=('dag_v2_'..string.sub(r.requestId,5)) then return redis.error_reply('abv2_grant_commit_mismatch') end",
 " if r.grantId and r.grantId~=p.grantId then return redis.error_reply('abv2_grant_commit_conflict') end",
 " r.state='granted';r.grantId=p.grantId",
 " redis.call('SET',k,cjson.encode(r),'KEEPTTL')",
 " return cjson.encode({state='granted',requestId=r.requestId,attempt=r.attempt,approvedAt=r.approvedAt,grantId=r.grantId})",
 "end",
 "if op=='grant_receipt' then",
 " if r.state~='approved' and r.state~='granted' then return redis.error_reply('abv2_b_not_verified') end",
 " return cjson.encode({state=r.state,requestId=r.requestId,attempt=r.attempt,approvedAt=r.approvedAt,agent=r.agent,actor=r.actor,client=r.client,owner=r.owner,device=r.device,connection=r.connection,purpose=r.purpose or 'device',grantId=r.grantId or cjson.null})",
 "end",
 "if r.state~='pending' then return redis.error_reply('abv2_request_not_pending') end",
 "if op=='deny' then",
 " r.state='denied';r.box=cjson.null;r.codeHash=cjson.null",
 " redis.call('SET',k,cjson.encode(r),'KEEPTTL')",
 " redis.call('ZREM',r.indexKey,r.requestId)",
 " return cjson.encode({state='denied',requestId=r.requestId})",
 "end",
 "if tonumber(p.attempt)~=r.attempt then return redis.error_reply('abv2_attempt_changed') end",
 "if op=='refresh' then",
 " if r.refreshed>=3 then return redis.error_reply('abv2_refresh_limit') end",
 " if now-r.rotatedAt<5000 then return redis.error_reply('abv2_refresh_cooldown') end",
 " if p.suffix==r.suffix or p.bFingerprint==r.bFingerprint then return redis.error_reply('abv2_duplicate_code') end",
 " r.attempt=r.attempt+1;r.refreshed=r.refreshed+1;r.failed=0",
 " r.suffix=p.suffix;r.codeHash=p.codeHash;r.bFingerprint=p.bFingerprint;r.box=p.box",
 " r.rotatedAt=now;r.expiresAt=now+300000",
 " redis.call('SET',k,cjson.encode(r),'PX',900000)",
 " redis.call('ZADD',r.indexKey,r.expiresAt,r.requestId)",
 " redis.call('PEXPIRE',r.indexKey,900000)",
 " return cjson.encode({state='pending',requestId=r.requestId,attempt=r.attempt,expiresAt=r.expiresAt})",
 "end",
 "if op=='approve' then",
 " if r.failed>=5 then return redis.error_reply('abv2_b_locked') end",
 " if r.codeHash~=p.codeHash then",
 "  r.failed=r.failed+1",
 "  if r.failed>=5 then r.state='locked';r.box=cjson.null;r.codeHash=cjson.null;redis.call('ZREM',r.indexKey,r.requestId) end",
 "  redis.call('SET',k,cjson.encode(r),'KEEPTTL')",
 "  return redis.error_reply('abv2_b_invalid')",
 " end",
 " r.state='approved';r.approvedAt=now;r.box=cjson.null;r.codeHash=cjson.null",
 " redis.call('SET',k,cjson.encode(r),'KEEPTTL')",
 " redis.call('ZREM',r.indexKey,r.requestId)",
 " return cjson.encode({state='approved',requestId=r.requestId,attempt=r.attempt})",
 "end",
 "return redis.error_reply('abv2_operation_invalid')"
].join('\n');

export class GoldAbV2PendingRedis {
 constructor({redis,prefix,sealingKey}={}){
  if(typeof redis?.eval!=='function'||!/^lr:gold:[a-z0-9_-]+:$/.test(prefix||'')||
     !Buffer.isBuffer(sealingKey)||sealingKey.length!==32)
   throw Error('abv2_redis_secret_required');
  this.redis=redis;this.prefix=prefix;this.secret=Buffer.from(sealingKey);
 }
 key(id){return this.prefix+'abv2:req:'+valid(id,'request');}
 indexKey(owner,device,connection){
  return this.prefix+'abv2:pending-index:'+fingerprint(this.secret,
   valid(owner,'owner')+'|'+valid(device,'device')+'|'+valid(connection,'connection'));
 }
 async eval(op,requestId,p,rateKeys=[]){
  return JSON.parse(await this.redis.eval(LUA,{keys:[this.key(requestId),...rateKeys],
   arguments:[op,JSON.stringify(p)]}));
 }
 async issue({ownerAccountId,actorAccountId,agentId,clientId,deviceId,connectionId,shortId,
   requestKey=null,purpose='device'}={}){
  const owner=valid(ownerAccountId,'owner'),actor=valid(actorAccountId,'actor'),
   agent=valid(agentId,'agent'),client=valid(clientId,'client'),
   device=valid(deviceId,'device'),connection=valid(connectionId,'connection');
  if(!AB_V2_SHORT_RE.test(shortId||''))throw Error('abv2_short_id_invalid');
  if(!['device','pro-share-guest'].includes(purpose)||
    (purpose==='device'&&owner!==actor)||
    (purpose==='pro-share-guest'&&owner===actor))
   throw Error('abv2_invalid_actor_purpose');
  if(requestKey!==null&&!/^[a-f0-9]{32}$/.test(requestKey))throw Error('abv2_request_key_invalid');
  // Stable server-secret-derived ID for retry with the same OAuth Agent
  // request key. Cannot collide across owner/Agent/device/connection.
  const requestId=requestKey===null?'av2_'+crypto.randomBytes(16).toString('hex'):
   'av2_'+fingerprint(this.secret,['issue-id',owner,actor,agent,client,device,connection,requestKey,
    ...(purpose==='device'?[]:[purpose])].join('|')).slice(0,32),attempt=1;
  const suffix=randomCode(5),b=mkB(),aad=requestId+'|'+attempt;
  const indexKey=this.indexKey(owner,device,connection);
 const row={requestId,owner,actor,agent,client,device,connection,purpose,indexKey,shortId,suffix,attempt,
   state:'pending',refreshed:0,failed:0,codeHash:fingerprint(this.secret,aad+'|'+b),
   bFingerprint:fingerprint(this.secret,b),box:encrypt(b,this.secret,aad)};
  const ar=this.prefix+'abv2:rate-actor:'+fingerprint(this.secret,actor+'|'+agent+'|'+device);
  const dr=this.prefix+'abv2:rate-device:'+fingerprint(this.secret,owner+'|'+device);
  const result=await this.eval('issue',requestId,row,[ar,dr,indexKey]);
  if(result.reused){
   if(result.state!=='pending')return {...result,shortId,bCode:null};
   const existing=await this.agentPoll({requestId,actorAccountId:actor,
    agentId:agent,clientId:client,connectionId:connection});
   return {...result,shortId,bCode:existing.bCode||null};
  }
  return {...result,shortId,bCode:b};
 }
 async agentPoll({requestId,actorAccountId,agentId,clientId,connectionId}={}){
  const row=await this.eval('agent',requestId,{actor:valid(actorAccountId,'actor'),
   agent:valid(agentId,'agent'),client:valid(clientId,'client'),connection:valid(connectionId,'connection')});
  if(row.state!=='pending')return {...row,box:undefined};
  if(!row.box||typeof row.box!=='object')throw Error('abv2_pending_code_missing');
  return {...row,box:undefined,bCode:decrypt(row.box,this.secret,requestId+'|'+row.attempt)};
 }
 scope({ownerAccountId,deviceId,connectionId}={}){
  return {owner:valid(ownerAccountId,'owner'),device:valid(deviceId,'device'),
   connection:valid(connectionId,'connection')};
 }
 wallView(input={}){
  return this.eval('wall',input.requestId,this.scope(input));
 }
 /** Bounded lookup for authorized owner Wall. Caller MUST first authenticate
  * owner and verify exact current device+connection; no fleet-wide scan. */
 async listDevicePending(input={}){
  const scope=this.scope(input),limit=input.limit??5;
  if(!Number.isSafeInteger(limit)||limit<1||limit>5)throw Error('abv2_index_limit_invalid');
  if(typeof this.redis.zRange!=='function')throw Error('abv2_redis_zrange_required');
  const key=this.indexKey(scope.owner,scope.device,scope.connection);
  const candidates=await this.redis.zRange(key,0,127);
  const matches=[];
  for(const requestId of candidates.reverse()){
   try{
    const v=await this.wallView({...input,requestId});
    if(v.state==='pending')matches.push(v);
   }catch(error){
    if(!String(error?.message||'').includes('abv2_not_found'))throw error;
   }
   if(matches.length===limit)break;
  }
  return matches;
 }
 async refresh(input={}){
  const {requestId,expectedAttempt}=input;
  if(!Number.isSafeInteger(expectedAttempt)||expectedAttempt<1)throw Error('abv2_attempt_invalid');
  const old=await this.wallView(input);
  if(old.state!=='pending'||old.attempt!==expectedAttempt)throw Error('abv2_attempt_changed');
  const oldSuffix=old.aCode.slice(7);
  let suffix;do{suffix=randomCode(5)}while(suffix===oldSuffix);
  const next=expectedAttempt+1,b=mkB(),aad=requestId+'|'+next;
  const row={...this.scope(input),attempt:expectedAttempt,suffix,
   codeHash:fingerprint(this.secret,aad+'|'+b),
   bFingerprint:fingerprint(this.secret,b),box:encrypt(b,this.secret,aad)};
  return this.eval('refresh',requestId,row);
 }
 approve(input={}){
  const {requestId,expectedAttempt,bCode}=input;
  if(!Number.isSafeInteger(expectedAttempt)||expectedAttempt<1)throw Error('abv2_attempt_invalid');
  const b=normalizeB(bCode);
  return this.eval('approve',requestId,{...this.scope(input),attempt:expectedAttempt,
   codeHash:fingerprint(this.secret,requestId+'|'+expectedAttempt+'|'+b)});
 }
 // Internal-only: a Redis server-clock receipt proves B was checked,
 // but DOES NOT prove a durable 24h grant. Never expose it via owner JSON.
 grantReceipt(input={}){
  return this.eval('grant_receipt',input.requestId,this.scope(input));
 }
 // Call only AFTER PostgreSQL flush/readback succeeds. Atomic idempotent
 // marker, not itself a grant. Requires the exact deterministic grant ID.
 commitGrant(input={}){
  const {requestId,attempt,approvedAt,grantId}=input;
  if(!/^av2_[a-f0-9]{32}$/.test(String(requestId||''))||
    !Number.isSafeInteger(attempt)||attempt<1||
    !Number.isSafeInteger(approvedAt)||approvedAt<1||
    grantId!=='dag_v2_'+requestId.slice(4))
   throw Error('abv2_grant_commit_invalid');
  return this.eval('grant_commit',requestId,{...this.scope(input),
   attempt,approvedAt,grantId});
 }
 deny(input={}){return this.eval('deny',input.requestId,this.scope(input));}
}
