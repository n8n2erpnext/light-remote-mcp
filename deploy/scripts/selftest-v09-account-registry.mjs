import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountRegistry,AccountError} from '../../operator-host/account-registry.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-account-'));
const stateFile=path.join(dir,'accounts.json');
let now=1_780_000_000_000;
const events=[];
const registry=new AccountRegistry({stateFile,bootstrapAccountId:'self-hosted-local',sessionTtlMs:60*60*1000,now:()=>now,emit:e=>events.push(e)});
function expectError(fn,message,status){let caught=null;try{fn();}catch(e){caught=e;}if(!(caught instanceof AccountError)||caught.message!==message||caught.status!==status)throw new Error(`expected_${message}_${status}`);}
try{
  const proof=registry.issueOwnerProof({accountId:'self-hosted-local',deviceId:'dev_owner_test'});
  if(!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(proof.code)||proof.deviceId!=='dev_owner_test')throw new Error('owner_proof_issue_failed');
  const consumed=registry.consumeOwnerProof(proof.code);if(consumed.deviceId!=='dev_owner_test')throw new Error('owner_proof_consume_failed');
  expectError(()=>registry.consumeOwnerProof(proof.code),'owner_migration_proof_invalid',401);
  if(events.some(e=>JSON.stringify(e).includes(proof.code)))throw new Error('owner_proof_leaked_to_event');
  const first=registry.register({email:'Owner@Example.com',password:'correct horse battery staple'});
  if(first.account.accountId!=='self-hosted-local'||first.account.email!=='owner@example.com'||first.account.plan!=='free')throw new Error('bootstrap_account_contract_failed');
  const raw=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  if(JSON.stringify(raw).includes('correct horse battery staple'))throw new Error('plaintext_password_persisted');
  if(JSON.stringify(raw).includes(first.token))throw new Error('session_token_persisted');
  if(!String(raw.accounts[0].passwordHash||'').startsWith('scrypt$'))throw new Error('password_not_scrypt');
  if(!raw.sessions[0]?.tokenHash)throw new Error('session_hash_missing');
  const auth=registry.authenticate(first.token);
  if(auth.account.accountId!==first.account.accountId)throw new Error('authenticate_failed');
  expectError(()=>registry.register({email:'OWNER@example.com',password:'another safe password'}),'account_email_exists',409);
  expectError(()=>registry.login({email:'owner@example.com',password:'wrong password'}),'invalid_account_credentials',401);
  const login=registry.login({email:'owner@example.com',password:'correct horse battery staple'});
  if(!login.token||login.token===first.token)throw new Error('fresh_login_session_required');
  expectError(()=>registry.register({email:'second@example.com',password:'second account password'}),'account_registration_closed',409);
  if(events.some(e=>'email' in e))throw new Error('account_event_leaks_email');
  const pro=registry.setPlan('self-hosted-local','pro');if(pro.plan!=='pro')throw new Error('account_plan_pro_failed');
  const vip=registry.setPlan('self-hosted-local','VIP');if(vip.plan!=='vip')throw new Error('account_plan_vip_failed');
  expectError(()=>registry.setPlan('self-hosted-local','enterprise'),'invalid_account_plan',400);
  const reloaded=new AccountRegistry({stateFile,bootstrapAccountId:'self-hosted-local',sessionTtlMs:60*60*1000,now:()=>now});
  if(reloaded.authenticate(login.token).account.email!=='owner@example.com')throw new Error('persistence_reload_failed');
  const out=reloaded.logout(login.token);if(!out.loggedOut)throw new Error('logout_failed');
  expectError(()=>reloaded.authenticate(login.token),'account_session_required',401);
  now+=2*60*60*1000;
  expectError(()=>reloaded.authenticate(first.token),'account_session_required',401);
  console.log(JSON.stringify({ok:true,bootstrapAccount:true,passwordHashed:true,tokenHashed:true,persistence:true,logout:true,expiry:true,noEmailAudit:true,ownerProofOneTime:true,planAuthority:true},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
