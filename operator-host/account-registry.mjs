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
    this.now=now;this.emit=emit;this.accounts=new Map();this.byEmail=new Map();this.sessions=new Map();this.ownerProofs=new Map();this.loadError=null;this._load();
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile);fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const payload={schemaVersion:1,accounts:[...this.accounts.values()],sessions:[...this.sessions.values()]};
    const tmp=`${this.stateFile}.${process.pid}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(payload,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);
  }
  _load(){
    if(!this.stateFile||!fs.existsSync(this.stateFile))return;
    try{
      const data=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      if(data?.schemaVersion!==1||!Array.isArray(data.accounts)||!Array.isArray(data.sessions))throw new Error('invalid_schema');
      for(const row of data.accounts){if(!ACCOUNT_RE.test(String(row.accountId||''))||!EMAIL_RE.test(String(row.email||''))||!row.passwordHash)throw new Error('invalid_account');this.accounts.set(row.accountId,row);this.byEmail.set(normalizeEmail(row.email),row.accountId);}
      for(const row of data.sessions)if(row?.tokenHash&&this.accounts.has(row.accountId))this.sessions.set(row.tokenHash,row);
      this._prune(false);
    }catch(error){this.accounts.clear();this.byEmail.clear();this.sessions.clear();this.loadError=error?.message||'invalid_account_state';}
  }
  _prune(persist=true){
    const now=this.now();let changed=false;
    for(const [hash,row] of this.sessions)if(row.expiresAt<=now||!this.accounts.has(row.accountId)){this.sessions.delete(hash);changed=true;}
    if(changed&&persist)this._persist();return changed;
  }
  _viewAccount(row){const entitlement=entitlementView(row,this.now()),fleetProvisioning=row.fleetProvisioning&&FLEET_PROVISION_STATES.has(row.fleetProvisioning.state)?{...row.fleetProvisioning}:null;return {accountId:row.accountId,email:row.email,plan:entitlement.plan,entitlement,mainDeviceId:row.mainDeviceId||null,fleetProvisioning,status:row.status||'active',createdAt:row.createdAt,lastLoginAt:row.lastLoginAt||null};}
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
  register(input={}){
    const email=normalizeEmail(input.email),password=String(input.password||'');
    if(!EMAIL_RE.test(email)||email.length>254)throw new AccountError('invalid_email');
    if(password.length<10||password.length>1024)throw new AccountError('invalid_password');
    if(this.byEmail.has(email))throw new AccountError('account_email_exists',409);
    if(this.accounts.size>0)throw new AccountError('account_registration_closed',409);
    const accountId=this.bootstrapAccountId;
    const now=this.now(),row={accountId,email,passwordHash:passwordHash(password),plan:normalizePlan(input.plan||'free'),mainDeviceId:null,status:'active',createdAt:now,lastLoginAt:now};
    this.accounts.set(accountId,row);this.byEmail.set(email,accountId);this._persist();this.emit({type:'account_registered',accountId,status:'active'});return this._issue(row);
  }
  provision(input={}){
    const email=normalizeEmail(input.email),password=String(input.password||''),requested=String(input.accountId||'').trim();
    if(!EMAIL_RE.test(email)||email.length>254)throw new AccountError('invalid_email');
    if(password.length<10||password.length>1024)throw new AccountError('invalid_password');
    if(this.byEmail.has(email))throw new AccountError('account_email_exists',409);
    const accountId=requested||`acct_${crypto.randomUUID()}`;
    if(!ACCOUNT_RE.test(accountId))throw new AccountError('invalid_account_id');
    if(this.accounts.has(accountId))throw new AccountError('account_id_exists',409);
    const now=this.now(),row={accountId,email,passwordHash:passwordHash(password),plan:normalizePlan(input.plan||'free'),mainDeviceId:null,status:'active',createdAt:now,lastLoginAt:null};
    this.accounts.set(accountId,row);this.byEmail.set(email,accountId);this._persist();this.emit({type:'account_provisioned',accountId,status:'active'});return this._viewAccount(row);
  }
  verifyCredentials(input={}, {recordLogin=false, eventType='account_login'}={}){
    const email=normalizeEmail(input.email),password=String(input.password||''),accountId=this.byEmail.get(email),row=accountId?this.accounts.get(accountId):null;
    if(!row||!safeEqual(row.email,email)||!verifyPassword(password,row.passwordHash))throw new AccountError('invalid_account_credentials',401);
    if((row.status||'active')!=='active')throw new AccountError('account_disabled',403);
    if(recordLogin){row.lastLoginAt=this.now();this._persist();this.emit({type:eventType,accountId:row.accountId,status:'ok'});}
    return this._viewAccount(row);
  }
  login(input={}){
    const account=this.verifyCredentials(input,{recordLogin:true,eventType:'account_login'}),row=this.accounts.get(account.accountId);
    return this._issue(row);
  }
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
