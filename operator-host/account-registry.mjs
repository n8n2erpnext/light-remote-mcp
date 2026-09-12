import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class AccountError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCOUNT_RE=/^[A-Za-z0-9._:-]{1,128}$/;
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
    this.now=now;this.emit=emit;this.accounts=new Map();this.byEmail=new Map();this.sessions=new Map();this.loadError=null;this._load();
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
  _viewAccount(row){return {accountId:row.accountId,email:row.email,plan:row.plan||'free',status:row.status||'active',createdAt:row.createdAt,lastLoginAt:row.lastLoginAt||null};}
  _issue(account){
    this._prune(false);
    const token=crypto.randomBytes(32).toString('base64url'),tokenHash=sha256(token),now=this.now();
    const row={sessionId:`acctsess_${crypto.randomUUID()}`,tokenHash,accountId:account.accountId,createdAt:now,lastSeenAt:now,expiresAt:now+this.sessionTtlMs};
    this.sessions.set(tokenHash,row);
    const mine=[...this.sessions.values()].filter(x=>x.accountId===account.accountId).sort((a,b)=>b.createdAt-a.createdAt);
    for(const stale of mine.slice(20))this.sessions.delete(stale.tokenHash);
    this._persist();return {token,session:{sessionId:row.sessionId,expiresAt:row.expiresAt},account:this._viewAccount(account)};
  }
  register(input={}){
    const email=normalizeEmail(input.email),password=String(input.password||'');
    if(!EMAIL_RE.test(email)||email.length>254)throw new AccountError('invalid_email');
    if(password.length<10||password.length>1024)throw new AccountError('invalid_password');
    if(this.byEmail.has(email))throw new AccountError('account_email_exists',409);
    if(this.accounts.size>0)throw new AccountError('account_registration_closed',409);
    const accountId=this.bootstrapAccountId;
    const now=this.now(),row={accountId,email,passwordHash:passwordHash(password),plan:'free',status:'active',createdAt:now,lastLoginAt:now};
    this.accounts.set(accountId,row);this.byEmail.set(email,accountId);this._persist();this.emit({type:'account_registered',accountId,status:'active'});return this._issue(row);
  }
  login(input={}){
    const email=normalizeEmail(input.email),password=String(input.password||''),accountId=this.byEmail.get(email),row=accountId?this.accounts.get(accountId):null;
    if(!row||!safeEqual(row.email,email)||!verifyPassword(password,row.passwordHash))throw new AccountError('invalid_account_credentials',401);
    if((row.status||'active')!=='active')throw new AccountError('account_disabled',403);
    row.lastLoginAt=this.now();this._persist();this.emit({type:'account_login',accountId:row.accountId,status:'ok'});return this._issue(row);
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
  list(){return [...this.accounts.values()].map(row=>this._viewAccount(row)).sort((a,b)=>a.createdAt-b.createdAt);}
}
