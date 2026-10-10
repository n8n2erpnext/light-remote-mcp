import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProTeamRegistry,ProTeamError} from '../../operator-host/pro-team-registry.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-pro-team-api-'));
const plans=new Map([['owner','pro'],['member1','free'],['member2','free'],['member3','free'],['member4','free'],['member5','free'],['outsider','free']]);
const proTeams=new ProTeamRegistry({stateFile:path.join(dir,'teams.json'),planFor:id=>plans.get(id)||'free',accountActive:id=>plans.has(id)});
const tokenAccount={tokenOwner:'owner',tokenMember:'member1',tokenOutsider:'outsider'};
const devices=new Map([['dev_owner',{deviceId:'dev_owner',accountId:'owner',state:'online'}],['dev_foreign',{deviceId:'dev_foreign',accountId:'outsider',state:'online'}],['dev_revoked',{deviceId:'dev_revoked',accountId:'owner',state:'revoked'}]]);
const events=[];
const deps={
  proTeams,
  requireAccount:req=>{
    const id=tokenAccount[req.headers?.authorization];if(!id)throw new Error('account_session_required');
    return {account:{accountId:id,plan:plans.get(id)}};
  },
  accounts:{assertOperational:id=>{if(!plans.has(id))throw new Error('account_not_found');return {accountId:id};}},
  devices:{get:id=>{const dev=devices.get(id);if(!dev)throw new Error('device_not_found');return dev;}},
  AccountError:class extends Error {constructor(message,status=403){super(message);this.status=status;}},
  readJson:async req=>req.body||{},
  sendJson:(res,status,data)=>{res.status=status;res.data=data;return true;},
  pushEvent:event=>events.push(event)
};
async function call(method,pathname,body={},token='tokenOwner'){
  const res={status:null,data:null};
  const req={method,body,headers:{authorization:token}};
  await handleAccountRoutes(req,res,new URL('http://local'+pathname),deps);
  assert(res.status,'missing_route_response:'+method+pathname);
  return res;
}
async function rejects(method,pathname,body,token,pattern){
  await assert.rejects(()=>call(method,pathname,body,token),pattern);
}
try{
  await rejects('POST','/v1/accounts/team',{},'tokenMember',/pro_team_subscription_required/);
  await rejects('POST','/v1/accounts/team',{},'unauthorized',/account_session_required/);
  assert.equal((await call('POST','/v1/accounts/team')).status,201);
  assert.equal((await call('GET','/v1/accounts/team')).data.team.usedSeats,1);
  await rejects('POST','/v1/accounts/team/invite',{memberAccountId:'unknown'},'tokenOwner',/account_not_found/);
  await rejects('POST','/v1/accounts/team/device/share',{deviceId:'dev_foreign'},'tokenOwner',/team_device_not_owned/);
  await rejects('POST','/v1/accounts/team/device/share',{deviceId:'dev_revoked'},'tokenOwner',/team_device_revoked/);
  await rejects('POST','/v1/accounts/team/device/share',{deviceId:'dev_owner'},'tokenMember',/team_device_not_owned/);
  const invitation=(await call('POST','/v1/accounts/team/invite',{memberAccountId:'member1'})).data.invite;
  assert(invitation.inviteCode);
  await rejects('POST','/v1/accounts/team/accept',{inviteCode:invitation.inviteCode},'tokenOutsider',/team_invite_invalid/);
  assert.equal((await call('POST','/v1/accounts/team/accept',{inviteCode:invitation.inviteCode},'tokenMember')).status,200);
  await rejects('POST','/v1/accounts/team/accept',{inviteCode:invitation.inviteCode},'tokenMember',/team_invite_invalid/);
  assert.equal((await call('POST','/v1/accounts/team/device/share',{deviceId:'dev_owner'})).data.team.devices[0],'dev_owner');
  assert.equal(proTeams.authorize({deviceOwnerAccountId:'owner',actorAccountId:'member1',deviceId:'dev_owner'}),true);
  assert.deepEqual((await call('GET','/v1/accounts/team/memberships',{},'tokenMember')).data.memberships[0].sharedDevices,['dev_owner']);
  assert.deepEqual((await call('GET','/v1/accounts/team/memberships',{},'tokenOutsider')).data.memberships,[]);
  assert.equal((await call('GET','/v1/accounts/team')).data.crossAccountExecutionEnabled,false);
  await rejects('POST','/v1/accounts/team/member/remove',{memberAccountId:'owner'},'tokenOwner',/team_owner_cannot_remove_self/);
  await rejects('POST','/v1/accounts/team/member/remove',{memberAccountId:'owner'},'tokenMember',/team_not_found/);
  await call('POST','/v1/accounts/team/member/remove',{memberAccountId:'member1'});
  assert.equal(proTeams.authorize({deviceOwnerAccountId:'owner',actorAccountId:'member1',deviceId:'dev_owner'}),false);
  plans.set('owner','free');
  assert.deepEqual((await call('GET','/v1/accounts/team/memberships',{},'tokenMember')).data.memberships,[]);
  assert.equal(proTeams.authorize({deviceOwnerAccountId:'owner',actorAccountId:'member1',deviceId:'dev_owner'}),false);
  await rejects('POST','/v1/accounts/team/device/share',{deviceId:'dev_owner'},'tokenOwner',/pro_team_subscription_required/);
  const portal=fs.readFileSync(new URL('../../plugin-server/account-portal.mjs',import.meta.url),'utf8');
  for(const action of ['team-create','team-invite','team-accept','team-remove','team-device-share','team-device-unshare'])assert(portal.includes("'"+action+"'"),'portal_action_missing:'+action);
  assert(portal.includes("sameOriginMutation(req)"),'missing CSRF guard');
  assert(portal.includes("const token=requireAccount(req,res)"),'missing account session guard');
  console.log('team_account_session_owner_member_isolation=PASS');
  console.log('team_invite_single_use_account_bound=PASS');
  console.log('team_share_real_device_owner_and_revocation=PASS');
  console.log('team_pro_only_downgrade_fail_closed=PASS');
  console.log('team_cross_account_execution_still_disabled=PASS');
  console.log('team_portal_csrf_and_cookie_session_guard=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
