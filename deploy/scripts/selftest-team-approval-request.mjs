import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {requestTeamMemberApproval} from '../../operator-host/team-approval-requests.mjs';
import {verifyTeamMemberAuthorization} from '../../operator-host/team-member-auth.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';
import {mintTeamPrincipalProof,TeamPrincipalProofVerifier,verifyTeamPrincipalRequest,teamOAuthAgentId} from '../../lib/team-oauth-principal-proof.mjs';
let plan='pro';const owner='owner',member='member',stranger='stranger',deviceId='dev_team_11',agentId=teamOAuthAgentId({accountId:'member',clientId:'agent-default'});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-team-ab-route-'));
const teamRegistry=new ProTeamRegistry({stateFile:path.join(dir,'teams.json'),planFor:id=>id===owner?plan:'free',accountActive:()=>true});
const accessGrants=new DeviceAccessGrantRegistry({stateFile:path.join(dir,'grants.json')});
const device={accountId:owner,deviceId,state:'online'};
const connection={accountId:owner,connectionId:'conn_owner_2026',hardExpiresAt:Date.now()+90*60_000};
const devices={get:id=>id===deviceId?device:(()=>{throw Error('device_not_found')})()};
const connections={assertConnected:id=>id===deviceId?connection:(()=>{throw Error('device_not_found')})()};
const base={actorAccountId:member,deviceId,agentId,devices,connections,accessGrants,teamRegistry,planFor:()=>plan};
const fail=(args,pattern)=>assert.throws(()=>requestTeamMemberApproval({...base,...args}),pattern);
const scope=new Map([['ownerToken',owner],['memberToken',member],['strangerToken',stranger]]);
const {privateKey,publicKey}=crypto.generateKeyPairSync('ed25519');
const verifier=new TeamPrincipalProofVerifier({publicKey});
const deps={
  proTeams:teamRegistry,accessGrants,devices,connections,
  verifyTeamPrincipal:(req,url,body)=>verifyTeamPrincipalRequest(req,url,body,verifier),
  operationalAccount:id=>({accountId:id,plan:id===owner?plan:'free'}),
  requestTeamMemberApproval,
  operationalAccount:id=>({accountId:id,plan:id===owner?plan:'free'}),
  AccountError:class AccountError extends Error{constructor(message,status=403){super(message);this.status=status;}},
  readJson:async req=>req.body||{},
  requireAccount:req=>{const accountId=scope.get(req.headers.token);if(!accountId)throw Error('account_session_required');return {account:{accountId}};},
  sendJson:(res,status,data)=>{res.status=status;res.data=data;return true;}
};
async function post(token,body){
  const actor=scope.get(token);
  if(!actor)throw Error('oauth_plugin_identity_required');
  const route='/v1/plugin/team/access/request';
  const cleanBody={deviceId:body.deviceId};
  const proof=mintTeamPrincipalProof({
    identity:{accountId:actor,clientId:body.agentId||'agent-default'},
    method:'POST',targetPath:route,body:cleanBody,privateKey
  });
  const req={method:'POST',headers:{token,'x-light-remote-team-proof':proof},body:cleanBody},res={};
  await handleAccountRoutes(req,res,new URL('http://local'+route),deps);
  return res;
}
async function webPost(token,body){
  const req={method:'POST',headers:{token},body},res={};
  await handleAccountRoutes(req,res,new URL('http://local/v1/accounts/team/access/request'),deps);
  return res;
}
try{
  fail({},/pro_team_membership_required/);
  teamRegistry.grantTeamAccess({ownerAccountId:owner,validUntil:Date.now()+30*86400000});
teamRegistry.create({ownerAccountId:owner});
  const invite=teamRegistry.invite({ownerAccountId:owner,memberAccountId:member});
  teamRegistry.accept({memberAccountId:member,inviteCode:invite.inviteCode});
  fail({},/pro_team_membership_required/);
  teamRegistry.shareDevice({ownerAccountId:owner,deviceId,deviceOwnerAccountId:owner});
  fail({actorAccountId:stranger},/pro_team_membership_required/);
  fail({actorAccountId:owner},/pro_team_membership_required/);
  fail({agentId:''},/invalid_team_approval_identity/);
  fail({deviceId:'../secrets'},/invalid_team_approval_identity/);
  fail({connections:{assertConnected:()=>({...connection,accountId:stranger})}},/team_owner_connection_required/);
  fail({devices:{get:()=>({...device,state:'revoked'})}},/team_device_unavailable/);
  await assert.rejects(()=>post('strangerToken',{deviceId,agentId}),/pro_team_membership_required/);
  await assert.rejects(()=>post('ownerToken',{deviceId,agentId}),/pro_team_membership_required/);
  await assert.rejects(()=>post('invalidToken',{deviceId,agentId}),/oauth_plugin_identity_required/);
  await assert.rejects(()=>webPost('memberToken',{deviceId,agentId}),/team_approval_requires_oauth_plugin/);
  await assert.rejects(()=>webPost('invalidToken',{deviceId,agentId}),/account_session_required/);
  const out=await post('memberToken',{deviceId});
  assert.equal(out.status,201);assert.equal(out.data.approval.state,'pending');
  assert.equal(out.data.approval.crossAccountExecutionEnabled,false);
  assert(out.data.approval.pollToken);
  assert.equal(accessGrants.pendingForDevice(deviceId).length,1);
  assert.equal(accessGrants.pendingForDevice(deviceId)[0].accountId,member,'owner must see verified requester account');
  assert.throws(()=>verifyTeamMemberAuthorization({device,connection,actorAccountId:member,agentId,
    accessGrants,teamRegistry,planFor:()=>plan,accessGrantId:null}),/team_actor_approval_required/);
  const approval=accessGrants.approve(out.data.approval.requestId,{deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt});
  const route=verifyTeamMemberAuthorization({device,connection,actorAccountId:member,agentId,
    accessGrants,teamRegistry,planFor:()=>plan,accessGrantId:approval.grantId});
  assert.equal(route.billedAccountId,owner);
  assert.equal(route.sharedTeam,true);
  assert.equal(route.maxWorkers,3);
  assert.throws(()=>verifyTeamMemberAuthorization({device,connection,actorAccountId:member,agentId:'other-agent',
    accessGrants,teamRegistry,planFor:()=>plan,accessGrantId:approval.grantId}),/device_access_grant_agent_mismatch/);
  const second=await post('memberToken',{deviceId,agentId:'other-agent'});
  assert.equal(second.status,201);
  assert.notEqual(second.data.approval.requestId,out.data.approval.requestId);
  for(let n=3;n<=5;n++)assert.equal((await post('memberToken',{deviceId,agentId:'member-extra-'+n})).status,201);
  await assert.rejects(()=>post('memberToken',{deviceId,agentId:'member-flood-6'}),/team_approval_rate_limited/);
  teamRegistry.unshareDevice({ownerAccountId:owner,deviceId});
  fail({},/pro_team_membership_required/);
  teamRegistry.shareDevice({ownerAccountId:owner,deviceId,deviceOwnerAccountId:owner});
  plan='free';fail({},/pro_team_membership_required/);
  console.log('member_ab_request_requires_paid_owner_and_device_share=PASS');
  console.log('member_ab_verified_oauth_plugin_identity=PASS');
  console.log('member_ab_request_pending_until_local_approval=PASS');
  console.log('member_ab_unique_agent_and_owner_billed_entitlement=PASS');
  console.log('member_ab_no_authorization_after_unshare_or_downgrade=PASS');
  const portal=fs.readFileSync(new URL('../../plugin-server/account-portal.mjs',import.meta.url),'utf8');
  const wall=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
  assert(portal.includes("'team-access-request'"),'team request portal CSRF action missing');
  assert(portal.includes("team_approval_requires_oauth_plugin"),'browser must not self-assert OAuth client agentId');
  assert(wall.includes("accountId:found.accountId"),'Local Wall must surface A/B requester account');
  assert(wall.includes("esc(current.accountId||'unknown')"),'owner must see account before approving');
  console.log('team_local_wall_shows_requester_account=PASS');
  console.log('team_browser_agent_spoof_endpoint_disabled=PASS');
  console.log('team_cross_account_execution_remains_disabled=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
