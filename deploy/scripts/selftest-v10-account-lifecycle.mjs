import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountRegistry,AccountError} from '../../operator-host/account-registry.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-account-life-')),stateFile=path.join(dir,'accounts.json');let now=1_800_000_000_000;
function expect(fn,msg){let got='';try{fn();}catch(e){got=e.message}if(got!==msg)throw new Error(`expected_${msg}_got_${got}`);}
try{
  const r=new AccountRegistry({stateFile,now:()=>now});
  const a=r.registerHosted({email:'life@example.test',password:'Initial password 123'});
  const reset=r.issueOneTimeToken('password_reset',a.account.email,{ttlMs:30*60_000});
  if(!reset.issued||!reset.token)throw new Error('reset_not_issued');
  const disk1=fs.readFileSync(stateFile,'utf8');if(disk1.includes(reset.token))throw new Error('reset_token_plaintext_persisted');
  const account=r.consumeOneTimeToken('password_reset',reset.token);r.resetPassword(account.accountId,'Changed password 456',{invalidateSessions:true});
  expect(()=>r.consumeOneTimeToken('password_reset',reset.token),'account_one_time_token_invalid');
  if(r.login({email:a.account.email,password:'Changed password 456'}).account.accountId!==a.account.accountId)throw new Error('reset_login_failed');
  const magic=r.issueOneTimeToken('magic_login',a.account.email,{ttlMs:20*60_000});const magicLogin=r.loginWithOneTimeToken(magic.token);
  if(magicLogin.account.accountId!==a.account.accountId)throw new Error('magic_login_failed');
  expect(()=>r.loginWithOneTimeToken(magic.token),'account_one_time_token_invalid');
  const req=r.requestUpgrade(a.account.accountId,'pro');if(req.status!=='pending')throw new Error('upgrade_request_missing');
  const approved=r.resolveUpgradeRequest(req.requestId,{decision:'approve',durationMs:30*86400000});if(approved.account.plan!=='pro')throw new Error('upgrade_approve_failed');
  const g=r.loginOrRegisterGoogle({sub:'google-sub-1',email:'google@example.test',emailVerified:true});
  if(!g.created||!g.account.authProviders.includes('google'))throw new Error('google_create_failed');
  const g2=r.loginOrRegisterGoogle({sub:'google-sub-1',email:'google@example.test',emailVerified:true});if(g2.created)throw new Error('google_relogin_created_duplicate');
  const raw=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(raw.schemaVersion!==2)throw new Error('schema2_not_persisted');
  const reload=new AccountRegistry({stateFile,now:()=>now});
  if(reload.account(a.account.accountId).plan!=='pro'||reload.listUpgradeRequests().length!==1)throw new Error('schema2_reload_failed');
  console.log(JSON.stringify({ok:true,schema:2,passwordReset:true,magicLogin:true,googleLogin:true,directUpgrade:true,plaintextTokensPersisted:false},null,2));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
