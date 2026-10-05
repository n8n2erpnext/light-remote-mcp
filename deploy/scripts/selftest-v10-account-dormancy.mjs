import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountRegistry} from '../../operator-host/account-registry.mjs';
import {UsageRegistry} from '../../operator-host/usage-registry.mjs';

const DAY=24*60*60*1000;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-account-dormancy-'));
let now=Date.now();
const accounts=new AccountRegistry({stateFile:path.join(dir,'accounts.json'),bootstrapAccountId:'admin-root',now:()=>now});
const usage=new UsageRegistry({stateFile:path.join(dir,'usage.json'),now:()=>now});
function err(fn,name){let got='';try{fn()}catch(e){got=e.message}if(got!==name)throw new Error('expected_'+name+'_got_'+got);}
function make(email){return accounts.registerHosted({email,password:'Dormancy test password 12345'},{issueSession:false}).account;}

try{
  const a=make('idle@example.test');
  const raw=accounts.accounts.get(a.accountId);
  raw.createdAt=now-77*DAY;raw.lastLoginAt=raw.createdAt;accounts._persist();
  let scan=accounts.evaluateDormancy({[a.accountId]:{deviceCount:0,lastToolCallAt:null,lastDeviceAddedAt:null}});
  if(scan.notices.length!==1||scan.notices[0].kind!=='14d'||scan.transitions.length)throw new Error('warning_14d_failed');
  accounts.acknowledgeDormancyNotice(a.accountId,'14d');

  now+=11*DAY;
  scan=accounts.evaluateDormancy({[a.accountId]:{deviceCount:0,lastToolCallAt:null,lastDeviceAddedAt:null}});
  if(scan.notices.length!==1||scan.notices[0].kind!=='3d')throw new Error('warning_3d_failed');
  accounts.acknowledgeDormancyNotice(a.accountId,'3d');

  now+=3*DAY;
  scan=accounts.evaluateDormancy({[a.accountId]:{deviceCount:0,lastToolCallAt:null,lastDeviceAddedAt:null}});
  if(scan.transitions.length!==1||accounts.account(a.accountId).status!=='dormant')throw new Error('auto_dormant_failed');
  err(()=>accounts.assertOperational(a.accountId),'account_dormant');
  const dormantLogin=accounts.login({email:'idle@example.test',password:'Dormancy test password 12345'});
  if(!dormantLogin.token||dormantLogin.account.status!=='dormant')throw new Error('dormant_portal_login_failed');
  const active=accounts.reactivateDormant(a.accountId,{source:'self'});
  if(active.status!=='active'||!active.reactivatedAt)throw new Error('self_reactivate_failed');

  now+=89*DAY;
  scan=accounts.evaluateDormancy({[a.accountId]:{deviceCount:0,lastToolCallAt:null,lastDeviceAddedAt:null}});
  if(scan.transitions.length)throw new Error('reactivation_grace_failed');

  const deviceAccount=make('device@example.test');const dr=accounts.accounts.get(deviceAccount.accountId);dr.createdAt=now-200*DAY;accounts._persist();
  scan=accounts.evaluateDormancy({[deviceAccount.accountId]:{deviceCount:1,lastToolCallAt:null,lastDeviceAddedAt:now-150*DAY}});
  if(scan.notices.some(x=>x.account.accountId===deviceAccount.accountId)||scan.transitions.some(x=>x.account.accountId===deviceAccount.accountId)||accounts.account(deviceAccount.accountId).status!=='active')throw new Error('device_exemption_failed');

  const pro=make('pro@example.test');const pr=accounts.accounts.get(pro.accountId);pr.createdAt=now-200*DAY;accounts.applyEntitlement(pro.accountId,{plan:'pro',source:'test'});accounts._persist();
  scan=accounts.evaluateDormancy({[pro.accountId]:{deviceCount:0,lastToolCallAt:null,lastDeviceAddedAt:null}});
  if(scan.notices.some(x=>x.account.accountId===pro.accountId)||scan.transitions.some(x=>x.account.accountId===pro.accountId)||accounts.account(pro.accountId).status!=='active')throw new Error('pro_exemption_failed');

  const internal=make('internal@example.test');const ir=accounts.accounts.get(internal.accountId);ir.createdAt=now-200*DAY;accounts.setAccountGroup(internal.accountId,'grp_internal');accounts._persist();
  scan=accounts.evaluateDormancy({[internal.accountId]:{deviceCount:0,lastToolCallAt:null,lastDeviceAddedAt:null}});
  if(scan.notices.some(x=>x.account.accountId===internal.accountId)||scan.transitions.some(x=>x.account.accountId===internal.accountId)||accounts.account(internal.accountId).status!=='active')throw new Error('internal_exemption_failed');

  const guard=new AccountRegistry({stateFile:path.join(dir,'guard.json'),bootstrapAccountId:'admin-root',now:()=>now});
  guard._createAccount({accountId:'admin-root',email:'admin@example.test',password:'Protected admin password 12345',plan:'vip',source:'bootstrap',emailVerified:true});
  err(()=>guard.setAdminStatus('admin-root',{status:'admin_disabled',by:'test-admin',reason:'should fail'}),'account_disable_protected');

  const disabled=make('disabled@example.test');
  const live=accounts.login({email:'disabled@example.test',password:'Dormancy test password 12345'});
  if(!live.token)throw new Error('pre_disable_login_failed');
  const off=accounts.setAdminStatus(disabled.accountId,{status:'admin_disabled',by:'test-admin',reason:'test'});
  if(off.status!=='admin_disabled'||off.disableReason!=='test')throw new Error('admin_disable_failed');
  err(()=>accounts.authenticate(live.token),'account_session_required');
  err(()=>accounts.login({email:'disabled@example.test',password:'Dormancy test password 12345'}),'account_admin_disabled');
  const enabled=accounts.setAdminStatus(disabled.accountId,{status:'active',by:'test-admin',reason:'reenable'});
  if(enabled.status!=='active'||!enabled.reactivatedAt)throw new Error('admin_enable_failed');

  usage.ingest({type:'session_activity',action:'toolCalls',accountId:a.accountId,deviceId:'dev-1',at:new Date(now).toISOString()});
  const us=usage.summary(a.accountId,{months:1});
  if(us.toolCallsThisMonth!==1||us.lastToolCallAt!==now)throw new Error('usage_last_tool_call_failed');

  accounts.recordDeviceAdded(a.accountId,now);
  if(accounts.account(a.accountId).lastDeviceAddedAt!==now)throw new Error('device_added_activity_failed');

  console.log('auto-dormant-free-90d=PASS');
  console.log('dormancy-warning-14d-3d=PASS');
  console.log('dormant-self-reactivation=PASS');
  console.log('dormancy-device-plan-group-exemptions=PASS');
  console.log('admin-disable-enable=PASS');
  console.log('usage-last-tool-call=PASS');
  console.log('device-added-activity=PASS');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
