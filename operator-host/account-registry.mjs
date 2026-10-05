import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class AccountError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_RE=/^[A-Za-z0-9._:-]{1,128}$/;
const OWNER_PROOF_TTL_MS=5*60*1000;
const ACCOUNT_PLANS=new Set(['free','pro','vip']);
const PLAN_RANK=Object.freeze({free:0,pro:1,vip:2});
const FLEET_PROVISION_STATES=new Set(['starting','configuring','ready','online','update_required','failed']);
const PENDING_REG_TTL_MS=24*60*60*1000;
const VERIFICATION_TTL_MS=30*60*1000;
const VERIFICATION_RESEND_BACKOFF_MS=[60_000,120_000,5*60_000,15*60_000];
const MAX_VERIFICATION_SENDS=5;
const MAX_PIN_ATTEMPTS=3;
const DEFAULT_GROUPS=Object.freeze([
  {groupId:'grp_default',name:'Default',protected:true},
  {groupId:'grp_internal',name:'Internal',protected:false},
  {groupId:'grp_reviewer',name:'Reviewer',protected:false},
  {groupId:'grp_customers',name:'Customers',protected:false},
  {groupId:'grp_partners',name:'Partners',protected:false}
]);
function normalizePlan(value){const plan=String(value||'free').trim().toLowerCase();if(!ACCOUNT_PLANS.has(plan))throw new AccountError('invalid_account_plan');return plan;}
function entitlementView(row,now){
  const e=row.entitlement;
  if(e&&ACCOUNT_PLANS.has(e.plan)){const active=e.validUntil==null||Number(e.validUntil)>now;if(active)return {entitlementId:e.entitlementId,plan:e.plan,source:e.source||'admin',sourceRef:e.sourceRef||null,validFrom:Number(e.validFrom)||row.createdAt,validUntil:e.validUntil==null?null:Number(e.validUntil),grantedAt:Number(e.grantedAt)||row.createdAt};}
  const legacy=normalizePlan(row.plan||'free');
  if(legacy!=='free'&&!e)return {entitlementId:null,plan:legacy,source:'legacy',sourceRef:null,validFrom:row.createdAt,validUntil:null,grantedAt:row.createdAt};
  return {entitlementId:null,plan:'free',source:e?'expired':'default',sourceRef:e?.sourceRef||null,validFrom:e?.validFrom||row.createdAt,validUntil:e?.validUntil||null,grantedAt:e?.grantedAt||row.createdAt};
}
function ownerCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',bytes=crypto.randomBytes(8);let out='';for(let i=0;i<8;i++)out+=alphabet[bytes[i]%alphabet.length];return `${out.slice(0,4)}-${out.slice(4)}`;}
function normalizeOwnerCode(value){const raw=String(value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');return raw.length===8?`${raw.slice(0,4)}-${raw.slice(4)}`:'';}
function normalizeEmail(value){return String(value||'').trim().toLowerCase();}
function sha256(value){return crypto.createHash('sha256').update(String(value||'')).digest('hex');}
function safeEqual(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&aa.length>0&&crypto.timingSafeEqual(aa,bb);}
function passwordHash(password,salt=crypto.randomBytes(16)){
  const derived=crypto.scryptSync(String(password),salt,32);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
function verifyPassword(password,encoded){
  const [kind,saltB64,hashB64]=String(encoded||'').split('$');
  if(kind!=='scrypt'||!saltB64||!hashB64)return false;
  const expected=Buffer.from(hashB64,'base64url');
  if(expected.length!==32)return false;
  const actual=crypto.scryptSync(String(password||''),Buffer.from(saltB64,'base64url'),expected.length);
  return crypto.timingSafeEqual(expected,actual);
}
export class AccountRegistry{
  constructor({stateFile=null,bootstrapAccountId='self-hosted-local',sessionTtlMs=7*24*60*60*1000,now=()=>Date.now(),emit=()=>{}}={}){
    if(!ACCOUNT_RE.test(String(bootstrapAccountId||'')))throw new AccountError('invalid_bootstrap_account_id');
    this.stateFile=stateFile;this.bootstrapAccountId=String(bootstrapAccountId);this.sessionTtlMs=Math.max(30*60*1000,Math.min(Number(sessionTtlMs)||7*24*60*60*1000,30*24*60*60*1000));
    this.now=now;this.emit=emit;this.accounts=new Map();this.byEmail=new Map();this.sessions=new Map();this.ownerProofs=new Map();this.oneTimeTokens=new Map();this.upgradeRequests=new Map();this.pendingRegistrations=new Map();this.googleSignupIntents=new Map();this.groups=new Map();this.loadError=null;this._load();this._ensureGroups();this._prune();
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const payload={schemaVersion:2,accounts:[...this.accounts.values()],sessions:[...this.sessions.values()],oneTimeTokens:[...this.oneTimeTokens.values()],upgradeRequests:[...this.upgradeRequests.values()],pendingRegistrations:[...this.pendingRegistrations.values()],googleSignupIntents:[...this.googleSignupIntents.values()],groups:[...this.groups.values()]};
    const tmp=`${this.stateFile}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(payload,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);
  }
  _load(){
    if(!this.stateFile||!fs.existsSync(this.stateFile))return;
    try{
      const data=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      if(![1,2].includes(Number(data?.schemaVersion))||!Array.isArray(data.accounts)||!Array.isArray(data.sessions))throw new Error('invalid_schema');
      for(const row of data.accounts){if(!ACCOUNT_RE.test(String(row.accountId||''))||!EMAIL_RE.test(String(row.email||''))||!row.passwordHash)throw new Error('invalid_account');this.accounts.set(row.accountId,row);this.byEmail.set(normalizeEmail(row.email),row.accountId);}
      for(const row of data.sessions)if(row?.tokenHash&&this.accounts.has(row.accountId))this.sessions.set(row.tokenHash,row);
      for(const row of Array.isArray(data.oneTimeTokens)?data.oneTimeTokens:[])if(row?.tokenHash&&this.accounts.has(row.accountId))this.oneTimeTokens.set(row.tokenHash,row);
      for(const row of Array.isArray(data.upgradeRequests)?data.upgradeRequests:[])if(row?.requestId&&this.accounts.has(row.accountId))this.upgradeRequests.set(row.requestId,row);
      for(const row of Array.isArray(data.pendingRegistrations)?data.pendingRegistrations:[])if(row?.pendingId&&row?.email&&row?.passwordHash)this.pendingRegistrations.set(row.pendingId,row);
      for(const row of Array.isArray(data.googleSignupIntents)?data.googleSignupIntents:[])if(row?.tokenHash&&row?.email&&row?.sub)this.googleSignupIntents.set(row.tokenHash,row);
      for(const row of Array.isArray(data.groups)?data.groups:[])if(row?.groupId&&row?.name)this.groups.set(row.groupId,row);
      this._prune(false);
    }catch(error){this.accounts.clear();this.byEmail.clear();this.sessions.clear();this.oneTimeTokens.clear();this.upgradeRequests.clear();this.pendingRegistrations.clear();this.googleSignupIntents.clear();this.groups.clear();this.loadError=error?.message||'invalid_account_state';}
  }
  _ensureGroups(){
    let changed=false;
    for(const g of DEFAULT_GROUPS)if(!this.groups.has(g.groupId)){this.groups.set(g.groupId,{...g,createdAt:this.now()});changed=true;}
    for(const row of this.accounts.values()){
      if(row.groupId&&this.groups.has(row.groupId))continue;
      const email=normalizeEmail(row.email),aid=String(row.accountId||'').toLowerCase();
      row.groupId=(aid.includes('reviewer')||email.includes('reviewer'))?'grp_reviewer':(aid===String(this.bootstrapAccountId).toLowerCase()||aid.includes('production')||aid.includes('bootstrap'))?'grp_internal':'grp_customers';changed=true;
    }
    if(changed)this._persist();
  }
  _prune(persist=true){
    const now=this.now();let changed=false;
    for(const [hash,row] of this.sessions)if(row.expiresAt<=now||!this.accounts.has(row.accountId)){this.sessions.delete(hash);changed=true;}
    for(const [hash,row] of this.oneTimeTokens)if(row.expiresAt<=now||!this.accounts.has(row.accountId)){this.oneTimeTokens.delete(hash);changed=true;}
    for(const [id,row] of this.pendingRegistrations)if(Number(row.expiresAt)<=now){this.pendingRegistrations.delete(id);changed=true;this.emit({type:'account_pending_registration_expired',pendingId:id,status:'expired'});}
    for(const [hash,row] of this.googleSignupIntents)if(Number(row.expiresAt)<=now){this.googleSignupIntents.delete(hash);changed=true;}
    if(changed&&persist)this._persist();return changed;
  }
  _groupFor(row){return this.groups.get(row.groupId)||this.groups.get('grp_default')||{groupId:'grp_default',name:'Default'};}
  _viewAccount(row){const entitlement=entitlementView(row,this.now()),fleetProvisioning=row.fleetProvisioning&&FLEET_PROVISION_STATES.has(row.fleetProvisioning.state)?{...row.fleetProvisioning}:null,providers=[],group=this._groupFor(row);if(row.passwordEnabled!==false)providers.push('password');if(row.googleSub)providers.push('google');return {accountId:row.accountId,email:row.email,emailVerified:Boolean(row.emailVerified),authProviders:providers,plan:entitlement.plan,entitlement,groupId:group.groupId,groupName:group.name,mainDeviceId:row.mainDeviceId||null,fleetProvisioning,status:row.status||'active',createdAt:row.createdAt,lastLoginAt:row.lastLoginAt||null};}
  _viewPending(row){return {pendingId:row.pendingId,email:row.email,maskedEmail:String(row.email).replace(/^(.{1,2}).*(@.*)$/,'$1••••$2'),provider:row.provider,createdAt:row.createdAt,expiresAt:row.expiresAt,challengeExpiresAt:row.challengeExpiresAt||null,sendCount:Number(row.sendCount)||0,maxSends:MAX_VERIFICATION_SENDS,resendAvailableAt:row.resendAvailableAt||null,pinAttempts:Number(row.pinAttempts)||0,maxPinAttempts:MAX_PIN_ATTEMPTS,challengeLocked:Boolean(row.challengeLocked)};}
  _newPendingChallenge(row){
    const now=this.now();if((Number(row.sendCount)||0)>=MAX_VERIFICATION_SENDS)throw new AccountError('verification_send_limit_reached',429);
    const token=crypto.randomBytes(32).toString('base64url'),pin=String(crypto.randomInt(0,1_000_000)).padStart(6,'0');
    row.verificationTokenHash=sha256(token);row.verificationPinHash=passwordHash(pin);row.challengeExpiresAt=now+VERIFICATION_TTL_MS;row.pinAttempts=0;row.challengeLocked=false;row.sendCount=(Number(row.sendCount)||0)+1;row.lastSentAt=now;
    row.resendAvailableAt=row.sendCount<MAX_VERIFICATION_SENDS?now+VERIFICATION_RESEND_BACKOFF_MS[Math.min(row.sendCount-1,VERIFICATION_RESEND_BACKOFF_MS.length-1)]:null;
    this._persist();this.emit({type:'account_verification_challenge_issued',pendingId:row.pendingId,status:'pending',sendCount:row.sendCount,challengeExpiresAt:row.challengeExpiresAt});
    return {pending:this._viewPending(row),token,pin};
  }
  _issue(account){
    this._prune(false);
    const token=crypto.randomBytes(32).toString('base64url'),tokenHash=sha256(token),now=this.now();
    const row={sessionId:`acctsess_${crypto.randomUUID()}`,tokenHash,accountId:account.accountId,createdAt:now,lastSeenAt:now,expiresAt:now+this.sessionTtlMs};
    this.sessions.set(tokenHash,row);
    const mine=[...this.sessions.values()].filter(x=>x.accountId===account.accountId).sort((a,b)=>b.createdAt-a.createdAt);
    for(const stale of mine.slice(20))this.sessions.delete(stale.tokenHash);
    this._persist();return {token,session:{sessionId:row.sessionId,expiresAt:row.expiresAt},account:this._viewAccount(account)};
  }
  issueOwnerProof({accountId,deviceId,ttlMs=OWNER_PROOF_TTL_MS}={}){
    const aid=String(accountId||''),did=String(deviceId||'');
    if(this.accounts.size>0)throw new AccountError('account_registration_closed',409);
    if(aid!==this.bootstrapAccountId)throw new AccountError('owner_migration_account_mismatch',403);
    if(!ACCOUNT_RE.test(did))throw new AccountError('invalid_owner_proof_device');
    const now=this.now(),ttl=Math.max(60_000,Math.min(Number(ttlMs)||OWNER_PROOF_TTL_MS,10*60*1000));
    for(const [hash,row] of this.ownerProofs)if(row.deviceId===did||row.expiresAt<=now)this.ownerProofs.delete(hash);
    const code=ownerCode(),codeHash=sha256(code),row={accountId:aid,deviceId:did,createdAt:now,expiresAt:now+ttl};
    this.ownerProofs.set(codeHash,row);this.emit({type:'account_owner_proof_issued',accountId:aid,deviceId:did,status:'pending',expiresAt:row.expiresAt});
    return {code,expiresAt:row.expiresAt,deviceId:did};
  }
  consumeOwnerProof(code){
    if(this.accounts.size>0)throw new AccountError('account_registration_closed',409);
    const normalized=normalizeOwnerCode(code);if(!normalized)throw new AccountError('owner_migration_proof_required',401);
    const hash=sha256(normalized),row=this.ownerProofs.get(hash),now=this.now();
    if(!row||row.expiresAt<=now){if(row)this.ownerProofs.delete(hash);throw new AccountError('owner_migration_proof_invalid',401);}
    this.ownerProofs.delete(hash);this.emit({type:'account_owner_proof_consumed',accountId:row.accountId,deviceId:row.deviceId,status:'consumed'});
    return {...row};
  }
  _createAccount({accountId,email,password,plan='free',source='hosted',emailVerified=false,googleSub=null,passwordEnabled=true}={}){
    const normalizedEmail=normalizeEmail(email),rawPassword=String(password||''),aid=String(accountId||'').trim();
    if(!ACCOUNT_RE.test(aid))throw new AccountError('invalid_account_id');
    if(!EMAIL_RE.test(normalizedEmail)||normalizedEmail.length>254)throw new AccountError('invalid_email');
    if(rawPassword.length<10||rawPassword.length>1024)throw new AccountError('invalid_password');
    if(this.byEmail.has(normalizedEmail))throw new AccountError('account_email_exists',409);
    if(this.accounts.has(aid))throw new AccountError('account_id_exists',409);
    const now=this.now(),row={accountId:aid,email:normalizedEmail,passwordHash:passwordHash(rawPassword),passwordEnabled:Boolean(passwordEnabled),emailVerified:Boolean(emailVerified),googleSub:googleSub?String(googleSub).slice(0,256):null,plan:normalizePlan(plan),groupId:source==='bootstrap'?'grp_internal':'grp_customers',mainDeviceId:null,status:'active',createdAt:now,lastLoginAt:now};
    this.accounts.set(aid,row);this.byEmail.set(normalizedEmail,aid);this._persist();
    this.emit({type:'account_registered',accountId:aid,status:'active',source:String(source||'hosted').slice(0,40)});
    return row;
  }
  registerHosted(input={},{issueSession=true}={}){
    let accountId='';
    for(let i=0;i<8;i++){const candidate=`acct_${crypto.randomUUID()}`;if(!this.accounts.has(candidate)){accountId=candidate;break;}}
    if(!accountId)throw new AccountError('account_id_generation_failed',500);
    const row=this._createAccount({accountId,email:input.email,password:input.password,plan:'free',source:'hosted'});
    return issueSession?this._issue(row):{account:this._viewAccount(row)};
  }
  register(input={}){
    const email=normalizeEmail(input.email),password=String(input.password||'');
    if(!EMAIL_RE.test(email)||email.length>254)throw new AccountError('invalid_email');
    if(password.length<10||password.length>1024)throw new AccountError('invalid_password');
    if(this.byEmail.has(email))throw new AccountError('account_email_exists',409);
    if(this.accounts.size>0)throw new AccountError('account_registration_closed',409);
    const accountId=this.bootstrapAccountId;
    const row=this._createAccount({accountId,email,password,plan:input.plan||'free',source:'bootstrap'});
    return this._issue(row);
  }
  verifyCredentials(input={}, {recordLogin=false, eventType='account_login'}={}){
    const email=normalizeEmail(input.email),password=String(input.password||''),accountId=this.byEmail.get(email),row=accountId?this.accounts.get(accountId):null;
    if(!row||row.passwordEnabled===false||!safeEqual(row.email,email)||!verifyPassword(password,row.passwordHash))throw new AccountError('invalid_account_credentials',401);
    if((row.status||'active')!=='active')throw new AccountError('account_disabled',403);
    if(recordLogin){row.lastLoginAt=this.now();this._persist();this.emit({type:eventType,accountId:row.accountId,status:'ok'});}
    return this._viewAccount(row);
  }
  login(input={}){
    const account=this.verifyCredentials(input,{recordLogin:true,eventType:'account_login'}),row=this.accounts.get(account.accountId);
    return this._issue(row);
  }
  issueOneTimeToken(kind,email,{ttlMs}={}){
    const type=String(kind||'');if(!['password_reset','magic_login'].includes(type))throw new AccountError('invalid_account_token_kind');
    this._prune(false);const aid=this.byEmail.get(normalizeEmail(email)),row=aid?this.accounts.get(aid):null;if(!row)return {issued:false};
    for(const [hash,item] of this.oneTimeTokens)if(item.accountId===row.accountId&&item.kind===type)this.oneTimeTokens.delete(hash);
    const token=crypto.randomBytes(32).toString('base64url'),tokenHash=sha256(token),now=this.now(),expiresAt=now+Math.max(60_000,Math.min(Number(ttlMs)||20*60_000,60*60_000));
    this.oneTimeTokens.set(tokenHash,{tokenHash,kind:type,accountId:row.accountId,createdAt:now,expiresAt});this._persist();
    this.emit({type:'account_one_time_token_issued',accountId:row.accountId,status:'pending',kind:type,expiresAt});return {issued:true,token,expiresAt,account:this._viewAccount(row)};
  }
  consumeOneTimeToken(kind,token){
    const type=String(kind||''),hash=sha256(token),item=this.oneTimeTokens.get(hash),now=this.now();
    if(!item||item.kind!==type||item.expiresAt<=now){if(item)this.oneTimeTokens.delete(hash);throw new AccountError('account_one_time_token_invalid',401);}
    const row=this.accounts.get(item.accountId);this.oneTimeTokens.delete(hash);this._persist();if(!row)throw new AccountError('account_not_found',404);
    this.emit({type:'account_one_time_token_consumed',accountId:row.accountId,status:'ok',kind:type});return this._viewAccount(row);
  }
  resetPassword(accountId,password,{invalidateSessions=true}={}){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const raw=String(password||'');if(raw.length<10||raw.length>1024)throw new AccountError('invalid_password');
    row.passwordHash=passwordHash(raw);row.passwordEnabled=true;row.lastLoginAt=this.now();
    if(invalidateSessions){for(const [hash,session] of this.sessions)if(session.accountId===row.accountId)this.sessions.delete(hash);}
    this._persist();this.emit({type:'account_password_reset',accountId:row.accountId,status:'ok'});
    return this._viewAccount(row);
  }
  loginWithOneTimeToken(token){
    const account=this.consumeOneTimeToken('magic_login',token),row=this.accounts.get(account.accountId);row.lastLoginAt=this.now();this._persist();this.emit({type:'account_magic_login',accountId:row.accountId,status:'ok'});return this._issue(row);
  }
  loginOrRegisterGoogle(input={}){
    const sub=String(input.sub||'').trim(),email=normalizeEmail(input.email),verified=input.emailVerified===true;
    if(!sub||sub.length>256||!verified||!EMAIL_RE.test(email))throw new AccountError('invalid_google_identity',401);
    let row=[...this.accounts.values()].find(x=>x.googleSub===sub)||null,created=false;
    if(row&&normalizeEmail(row.email)!==email)throw new AccountError('google_identity_email_mismatch',409);
    if(!row){const aid=this.byEmail.get(email);row=aid?this.accounts.get(aid):null;if(row?.googleSub&&row.googleSub!==sub)throw new AccountError('google_identity_conflict',409);}
    if(!row){let accountId='';for(let i=0;i<8;i++){const candidate=`acct_${crypto.randomUUID()}`;if(!this.accounts.has(candidate)){accountId=candidate;break;}}if(!accountId)throw new AccountError('account_id_generation_failed',500);row=this._createAccount({accountId,email,password:crypto.randomBytes(32).toString('base64url'),plan:'free',source:'google',emailVerified:true,googleSub:sub,passwordEnabled:false});created=true;}
    row.googleSub=sub;row.emailVerified=true;row.lastLoginAt=this.now();this._persist();this.emit({type:'account_google_login',accountId:row.accountId,status:'ok'});return {...this._issue(row),created};
  }
  googleLoginOrSignupIntent(input={}){
    this._prune();const sub=String(input.sub||'').trim(),email=normalizeEmail(input.email),verified=input.emailVerified===true;
    if(!sub||sub.length>256||!verified||!EMAIL_RE.test(email))throw new AccountError('invalid_google_identity',401);
    let row=[...this.accounts.values()].find(x=>x.googleSub===sub)||null;
    if(row&&normalizeEmail(row.email)!==email)throw new AccountError('google_identity_email_mismatch',409);
    if(!row){const aid=this.byEmail.get(email);row=aid?this.accounts.get(aid):null;if(row?.googleSub&&row.googleSub!==sub)throw new AccountError('google_identity_conflict',409);}
    if(row){row.googleSub=sub;row.emailVerified=true;row.lastLoginAt=this.now();this._persist();this.emit({type:'account_google_login',accountId:row.accountId,status:'ok'});return {registrationRequired:false,...this._issue(row)};}
    for(const [hash,item] of this.googleSignupIntents)if(item.sub===sub||item.email===email)this.googleSignupIntents.delete(hash);
    const token=crypto.randomBytes(32).toString('base64url'),tokenHash=sha256(token),now=this.now(),expiresAt=now+15*60_000;
    this.googleSignupIntents.set(tokenHash,{tokenHash,sub,email,createdAt:now,expiresAt});this._persist();
    this.emit({type:'account_google_signup_intent',status:'pending',expiresAt});return {registrationRequired:true,googleSignupToken:token,email,expiresAt};
  }
  googleSignupIntent(token){
    this._prune();const item=this.googleSignupIntents.get(sha256(token));if(!item||item.expiresAt<=this.now())throw new AccountError('google_signup_intent_invalid',401);
    return {email:item.email,expiresAt:item.expiresAt};
  }
  beginPendingRegistration(input={}){
    this._prune();let email=normalizeEmail(input.email),googleSub=null,provider='password';
    const rawPassword=String(input.password||'');if(rawPassword.length<10||rawPassword.length>1024)throw new AccountError('invalid_password');
    if(input.googleSignupToken){const hash=sha256(input.googleSignupToken),intent=this.googleSignupIntents.get(hash);if(!intent||intent.expiresAt<=this.now())throw new AccountError('google_signup_intent_invalid',401);email=intent.email;googleSub=intent.sub;provider='google';}
    if(!EMAIL_RE.test(email)||email.length>254)throw new AccountError('invalid_email');
    if(this.byEmail.has(email))throw new AccountError('account_email_exists',409);
    const existing=[...this.pendingRegistrations.values()].find(x=>x.email===email&&x.expiresAt>this.now());
    if(existing)return {existing:true,pending:this._viewPending(existing)};
    const now=this.now(),pendingId='preg_'+crypto.randomUUID(),row={pendingId,email,passwordHash:passwordHash(rawPassword),googleSub,provider,createdAt:now,expiresAt:now+PENDING_REG_TTL_MS,sendCount:0,challengeExpiresAt:null,resendAvailableAt:null,pinAttempts:0,challengeLocked:false};
    this.pendingRegistrations.set(pendingId,row);
    if(input.googleSignupToken)this.googleSignupIntents.delete(sha256(input.googleSignupToken));
    const challenge=this._newPendingChallenge(row);this.emit({type:'account_pending_registration_created',pendingId,status:'pending',provider,expiresAt:row.expiresAt});return {existing:false,...challenge};
  }
  pendingRegistration(pendingId){this._prune();const row=this.pendingRegistrations.get(String(pendingId||''));if(!row)throw new AccountError('pending_registration_not_found',404);return this._viewPending(row);}
  resendPendingVerification(pendingId){
    this._prune();const row=this.pendingRegistrations.get(String(pendingId||''));if(!row)throw new AccountError('pending_registration_not_found',404);
    if(row.sendCount>=MAX_VERIFICATION_SENDS)throw new AccountError('verification_send_limit_reached',429);
    if(row.resendAvailableAt&&row.resendAvailableAt>this.now())throw new AccountError('verification_resend_cooldown',429);
    return this._newPendingChallenge(row);
  }
  verifyPendingRegistration({pendingId='',pin='',token='',issueSession=true}={}){
    this._prune();let row=pendingId?this.pendingRegistrations.get(String(pendingId)):null;
    if(!row&&token){const h=sha256(token);row=[...this.pendingRegistrations.values()].find(x=>x.verificationTokenHash===h)||null;}
    if(!row)throw new AccountError('pending_registration_not_found',404);
    const now=this.now();if(row.expiresAt<=now){this.pendingRegistrations.delete(row.pendingId);this._persist();throw new AccountError('pending_registration_expired',410);}
    if(row.challengeLocked)throw new AccountError('verification_challenge_locked',423);
    if(!row.challengeExpiresAt||row.challengeExpiresAt<=now)throw new AccountError('verification_challenge_expired',410);
    let valid=false;
    if(token)valid=safeEqual(row.verificationTokenHash,sha256(token));
    else if(/^\d{6}$/.test(String(pin||'')))valid=verifyPassword(String(pin),row.verificationPinHash);
    else throw new AccountError('verification_pin_invalid',401);
    if(!valid){
      if(token){this.emit({type:'account_verification_failed',pendingId:row.pendingId,status:'invalid_link'});throw new AccountError('verification_link_invalid',401);}
      row.pinAttempts=(Number(row.pinAttempts)||0)+1;
      if(row.pinAttempts>=MAX_PIN_ATTEMPTS)row.challengeLocked=true;
      this._persist();this.emit({type:'account_verification_failed',pendingId:row.pendingId,status:row.challengeLocked?'locked':'invalid',pinAttempts:row.pinAttempts});
      throw new AccountError(row.challengeLocked?'verification_challenge_locked':'verification_pin_invalid',row.challengeLocked?423:401);
    }
    if(this.byEmail.has(row.email))throw new AccountError('account_email_exists',409);
    let accountId='';for(let i=0;i<8;i++){const candidate='acct_'+crypto.randomUUID();if(!this.accounts.has(candidate)){accountId=candidate;break;}}if(!accountId)throw new AccountError('account_id_generation_failed',500);
    const account={accountId,email:row.email,passwordHash:row.passwordHash,passwordEnabled:true,emailVerified:true,googleSub:row.googleSub?String(row.googleSub):null,plan:'free',groupId:'grp_customers',mainDeviceId:null,status:'active',createdAt:now,lastLoginAt:now};
    this.accounts.set(accountId,account);this.byEmail.set(row.email,accountId);this.pendingRegistrations.delete(row.pendingId);this._persist();
    this.emit({type:'account_registered',accountId,status:'active',source:row.provider||'verified'});this.emit({type:'account_email_verified',accountId,status:'ok'});
    return issueSession?this._issue(account):{account:this._viewAccount(account),token:null,session:null};
  }
  cancelPendingRegistration(pendingId,{reason='admin_cancelled'}={}){
    this._prune();const id=String(pendingId||''),row=this.pendingRegistrations.get(id);if(!row)throw new AccountError('pending_registration_not_found',404);
    this.pendingRegistrations.delete(id);this._persist();this.emit({type:'account_pending_registration_cancelled',pendingId:id,status:'cancelled',reason:String(reason).slice(0,80)});return this._viewPending(row);
  }
  listPendingRegistrations(){this._prune();return [...this.pendingRegistrations.values()].map(row=>this._viewPending(row)).sort((a,b)=>a.createdAt-b.createdAt);}
  listGroups(){const counts=new Map();for(const row of this.accounts.values())counts.set(row.groupId,(counts.get(row.groupId)||0)+1);return [...this.groups.values()].map(g=>({...g,accountCount:counts.get(g.groupId)||0})).sort((a,b)=>a.name.localeCompare(b.name));}
  createGroup(name){const value=String(name||'').trim();if(value.length<1||value.length>50)throw new AccountError('invalid_group_name');if([...this.groups.values()].some(g=>g.name.toLowerCase()===value.toLowerCase()))throw new AccountError('group_name_exists',409);const row={groupId:'grp_'+crypto.randomUUID(),name:value,protected:false,createdAt:this.now()};this.groups.set(row.groupId,row);this._persist();return {...row,accountCount:0};}
  renameGroup(groupId,name){const row=this.groups.get(String(groupId||''));if(!row)throw new AccountError('group_not_found',404);const value=String(name||'').trim();if(value.length<1||value.length>50)throw new AccountError('invalid_group_name');if([...this.groups.values()].some(g=>g.groupId!==row.groupId&&g.name.toLowerCase()===value.toLowerCase()))throw new AccountError('group_name_exists',409);row.name=value;this._persist();return {...row};}
  deleteGroup(groupId,{moveTo='grp_default'}={}){const id=String(groupId||''),row=this.groups.get(id);if(!row)throw new AccountError('group_not_found',404);if(row.protected)throw new AccountError('group_protected',409);const target=this.groups.get(String(moveTo||'grp_default'));if(!target||target.groupId===id)throw new AccountError('invalid_group_target');let moved=0;for(const account of this.accounts.values())if(account.groupId===id){account.groupId=target.groupId;moved++;}this.groups.delete(id);this._persist();return {deleted:id,movedTo:target.groupId,moved};}
  setAccountGroup(accountId,groupId){const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);const group=this.groups.get(String(groupId||''));if(!group)throw new AccountError('group_not_found',404);row.groupId=group.groupId;this._persist();return this._viewAccount(row);}
  authenticate(token,{touch=true}={}){
    this._prune();const hash=sha256(token),session=this.sessions.get(hash);
    if(!session)throw new AccountError('account_session_required',401);
    const account=this.accounts.get(session.accountId);if(!account||account.status==='disabled')throw new AccountError('account_session_invalid',401);
    if(touch){const now=this.now();if(now-session.lastSeenAt>=60_000){session.lastSeenAt=now;this._persist();}}
    return {account:this._viewAccount(account),session:{sessionId:session.sessionId,createdAt:session.createdAt,lastSeenAt:session.lastSeenAt,expiresAt:session.expiresAt}};
  }
  logout(token){const hash=sha256(token);const session=this.sessions.get(hash);if(session){this.sessions.delete(hash);this._persist();this.emit({type:'account_logout',accountId:session.accountId,status:'ok'});}return {loggedOut:Boolean(session)};}
  account(accountId){const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);return this._viewAccount(row);}
  applyEntitlement(accountId,input={}){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const next=normalizePlan(input.plan),now=this.now(),current=entitlementView(row,now),source=String(input.source||'admin').slice(0,40),sourceRef=input.sourceRef==null?null:String(input.sourceRef).slice(0,160),allowDowngrade=Boolean(input.allowDowngrade);
    if(!allowDowngrade&&PLAN_RANK[next]<PLAN_RANK[current.plan])throw new AccountError('account_entitlement_downgrade_not_allowed',409);
    const rawDuration=input.durationMs==null?null:Number(input.durationMs);if(rawDuration!=null&&(!Number.isFinite(rawDuration)||rawDuration<=0||rawDuration>10*365*86400000))throw new AccountError('invalid_entitlement_duration');
    if(!allowDowngrade&&current.plan===next&&current.validUntil==null&&current.plan!=='free')throw new AccountError('account_entitlement_permanent',409);
    let validUntil=null;if(rawDuration!=null){const base=current.plan===next&&current.validUntil&&current.validUntil>now?current.validUntil:now;validUntil=base+Math.round(rawDuration);}
    const prior=current.plan,entitlementId=String(input.entitlementId||`ent_${crypto.randomUUID()}`);
    row.plan=next;row.entitlement={entitlementId,plan:next,source,sourceRef,validFrom:now,validUntil,grantedAt:now};this._persist();
    this.emit({type:'account_entitlement_changed',accountId:row.accountId,status:'ok',fromPlan:prior,toPlan:next,source,validUntil});return this._viewAccount(row);
  }
  requestUpgrade(accountId,plan){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const target=normalizePlan(plan);if(target==='free')throw new AccountError('invalid_upgrade_plan');
    const current=entitlementView(row,this.now());if(PLAN_RANK[current.plan]>=PLAN_RANK[target])throw new AccountError('account_plan_already_sufficient',409);
    const pending=[...this.upgradeRequests.values()].find(x=>x.accountId===row.accountId&&x.plan===target&&x.status==='pending');if(pending)return {...pending};
    const now=this.now(),request={requestId:`upg_${crypto.randomUUID()}`,accountId:row.accountId,plan:target,status:'pending',createdAt:now,resolvedAt:null,resolution:null};
    this.upgradeRequests.set(request.requestId,request);this._persist();this.emit({type:'account_upgrade_requested',accountId:row.accountId,status:'pending',plan:target,requestId:request.requestId});return {...request};
  }
  listUpgradeRequests({status=null,accountId=null}={}){
    let rows=[...this.upgradeRequests.values()];if(status)rows=rows.filter(x=>x.status===status);if(accountId)rows=rows.filter(x=>x.accountId===String(accountId));return rows.sort((a,b)=>b.createdAt-a.createdAt).map(x=>({...x}));
  }
  resolveUpgradeRequest(requestId,{decision='approve',durationMs=null,sourceRef=null}={}){
    const req=this.upgradeRequests.get(String(requestId||''));if(!req)throw new AccountError('upgrade_request_not_found',404);if(req.status!=='pending')throw new AccountError('upgrade_request_already_resolved',409);
    const action=String(decision||'approve');if(!['approve','reject'].includes(action))throw new AccountError('invalid_upgrade_resolution');let account=this.account(req.accountId);
    if(action==='approve')account=this.applyEntitlement(req.accountId,{plan:req.plan,durationMs,source:'direct_upgrade',sourceRef:sourceRef||req.requestId});
    req.status=action==='approve'?'approved':'rejected';req.resolution=action;req.resolvedAt=this.now();this._persist();this.emit({type:'account_upgrade_resolved',accountId:req.accountId,status:req.status,plan:req.plan,requestId:req.requestId});return {request:{...req},account};
  }
  setFleetProvisioning(accountId,input={}){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const deviceId=String(input.deviceId||'').trim(),state=String(input.state||'').trim();
    if(!ACCOUNT_RE.test(deviceId))throw new AccountError('invalid_fleet_provision_device');
    if(!FLEET_PROVISION_STATES.has(state))throw new AccountError('invalid_fleet_provision_state');
    const now=this.now(),prior=row.fleetProvisioning||null;
    row.fleetProvisioning={deviceId,state,reason:input.reason==null?null:String(input.reason).slice(0,120),moduleVersion:input.moduleVersion==null?null:String(input.moduleVersion).slice(0,80),agentVersion:input.agentVersion==null?null:String(input.agentVersion).slice(0,80),minimumSupportedVersion:input.minimumSupportedVersion==null?null:String(input.minimumSupportedVersion).slice(0,80),latestVersion:input.latestVersion==null?null:String(input.latestVersion).slice(0,80),updateRequired:Boolean(input.updateRequired),port:input.port==null?null:Math.max(1,Math.min(Number(input.port)||5492,65535)),startedAt:prior?.deviceId===deviceId?Number(prior.startedAt)||now:now,updatedAt:now,onlineAt:state==='online'?(prior?.deviceId===deviceId?prior.onlineAt||now:now):(prior?.deviceId===deviceId?prior.onlineAt||null:null)};
    const materialFields=['deviceId','state','reason','moduleVersion','agentVersion','minimumSupportedVersion','latestVersion','updateRequired','port'];
    const materialChanged=!prior||materialFields.some(key=>prior[key]!==row.fleetProvisioning[key]);
    this._persist();if(materialChanged)this.emit({type:'account_fleet_provisioning_changed',accountId:row.accountId,deviceId,state,status:state,reason:row.fleetProvisioning.reason,moduleVersion:row.fleetProvisioning.moduleVersion,port:row.fleetProvisioning.port});return this._viewAccount(row);
  }
  clearFleetProvisioning(accountId,{reason='fleet_not_requested'}={}){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const prior=row.fleetProvisioning||null;if(!prior)return this._viewAccount(row);
    row.fleetProvisioning=null;this._persist();this.emit({type:'account_fleet_provisioning_cleared',accountId:row.accountId,deviceId:prior.deviceId||null,status:'cleared',reason:String(reason||'fleet_not_requested').slice(0,120)});return this._viewAccount(row);
  }
  setMainDevice(accountId,deviceId){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const next=String(deviceId||'').trim();if(!ACCOUNT_RE.test(next))throw new AccountError('invalid_main_device');
    const prior=row.mainDeviceId||null;if(prior===next)return this._viewAccount(row);
    row.mainDeviceId=next;this._persist();this.emit({type:'account_main_device_changed',accountId:row.accountId,status:'ok',fromDeviceId:prior,toDeviceId:next});return this._viewAccount(row);
  }
  clearMainDevice(accountId,{reason='main_device_cleared'}={}){
    const row=this.accounts.get(String(accountId||''));if(!row)throw new AccountError('account_not_found',404);
    const prior=row.mainDeviceId||null;if(!prior)return this._viewAccount(row);
    row.mainDeviceId=null;row.fleetProvisioning=null;this._persist();this.emit({type:'account_main_device_changed',accountId:row.accountId,status:'ok',fromDeviceId:prior,toDeviceId:null,reason:String(reason||'main_device_cleared').slice(0,80)});return this._viewAccount(row);
  }
  setPlan(accountId,plan){return this.applyEntitlement(accountId,{plan,source:'admin',durationMs:null,allowDowngrade:true});}
  list(){return [...this.accounts.values()].map(row=>this._viewAccount(row)).sort((a,b)=>a.createdAt-b.createdAt);}
}
