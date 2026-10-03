import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountRegistry, AccountError } from '../../operator-host/account-registry.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-hosted-account-')),stateFile=path.join(dir,'accounts.json'),events=[];
let now=1_790_000_000_000;
const registry=new AccountRegistry({stateFile,bootstrapAccountId:'self-hosted-local',now:()=>now,emit:e=>events.push(e)});
function expect(fn,message,status){let e=null;try{fn();}catch(x){e=x;}if(!(e instanceof AccountError)||e.message!==message||e.status!==status)throw new Error(`expected_${message}_${status}`);}
try{
 const owner=registry.register({email:'owner@example.test',password:'Owner password 12345',plan:'free'});
 if(owner.account.accountId!=='self-hosted-local')throw new Error('bootstrap_regressed');
 expect(()=>registry.register({email:'second-owner@example.test',password:'Second owner pass 123'}),'account_registration_closed',409);
 const a=registry.registerHosted({email:'Hosted-A@Example.test',password:'Hosted A password 12345',plan:'pro'});
 const b=registry.registerHosted({email:'hosted-b@example.test',password:'Hosted B password 12345'},{issueSession:false});
 if(!/^acct_[A-Za-z0-9-]+$/.test(a.account.accountId)||!/^acct_[A-Za-z0-9-]+$/.test(b.account.accountId)||a.account.accountId===b.account.accountId)throw new Error('hosted_ids_invalid');
 if(a.account.plan!=='free'||b.account.plan!=='free')throw new Error('hosted_plan_not_forced_free');
 if(a.account.email!=='hosted-a@example.test')throw new Error('hosted_email_not_normalized');
 if(!a.token||!a.session?.sessionId||'token' in b)throw new Error('hosted_issue_session_contract');
 expect(()=>registry.registerHosted({email:'HOSTED-A@example.test',password:'Duplicate password 123'}),'account_email_exists',409);
 const verified=registry.verifyCredentials({email:'hosted-a@example.test',password:'Hosted A password 12345'});
 if(verified.accountId!==a.account.accountId)throw new Error('hosted_verify_failed');
 const raw=fs.readFileSync(stateFile,'utf8');
 if(raw.includes('Hosted A password 12345')||raw.includes(a.token))throw new Error('hosted_secret_persisted');
 if(events.some(e=>'email' in e||'password' in e))throw new Error('hosted_event_secret_leak');
 const reloaded=new AccountRegistry({stateFile,bootstrapAccountId:'self-hosted-local',now:()=>now});
 if(reloaded.login({email:'hosted-b@example.test',password:'Hosted B password 12345'}).account.accountId!==b.account.accountId)throw new Error('hosted_reload_login_failed');
 console.log(JSON.stringify({ok:true,bootstrapPreserved:true,hostedAccounts:2,forcedFree:true,uniqueOpaqueIds:true,noSecretPersistence:true},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
