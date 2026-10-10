import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {AccountOperatorAdapter} from '../../plugin-server/operator-adapter.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';
import {requestTeamMemberApproval} from '../../operator-host/team-approval-requests.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

let plan='pro';
const deviceId='shared-device',owner='owner',member='member',clientId='oauth-client-member-01';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-team-oauth-'));
try{
  const teams=new ProTeamRegistry({stateFile:path.join(dir,'team.json'),
    planFor:()=>plan,accountActive:()=>true});
  const grants=new DeviceAccessGrantRegistry({stateFile:path.join(dir,'grant.json')});
  const device={deviceId,nodeId:deviceId,accountId:owner,state:'online'};
  const connection={connectionId:'owner-connection',accountId:owner,hardExpiresAt:Date.now()+3600000};
  const deps={
    AccountError:class AccountError extends Error{constructor(message,status=403){super(message);this.status=status;}},
    operationalAccount:id=>{
      if(![owner,member].includes(id))throw Error('account_not_found');
      return {accountId:id,plan:id===owner?plan:'free'};
    },
    proTeams:teams,requestTeamMemberApproval,accessGrants:grants,
    devices:{get:id=>id===deviceId?device:(()=>{throw Error('device_not_found')})()},
    connections:{assertConnected:id=>id===deviceId?connection:(()=>{throw Error('device_not_found')})()},
    readJson:async req=>req.body,sendJson:(res,status,data)=>{res.status=status;res.data=data;return true;}
  };
  const calls=[];
  const call=async(method,route,body)=>{
    calls.push({method,route,body});
    const res={};
    await handleAccountRoutes({method,body},res,new URL('http://local'+route),deps);
    return res.data;
  };
  const adapter=new AccountOperatorAdapter({accountId:member,clientId,scopes:['remote:read','remote:write']},{teamOperatorCall:call});
  const expectedAgent='plugin-'+crypto.createHash('sha256').update(member+'|'+clientId).digest('hex').slice(0,40);
  assert.equal(adapter.agentId,expectedAgent,'OAuth stable agentId from authenticated account and OAuth client');
  await assert.rejects(()=>adapter.teamAccessBegin(deviceId),/pro_team_membership_required/);
  teams.create({ownerAccountId:owner});
  const invite=teams.invite({ownerAccountId:owner,memberAccountId:member});
  teams.accept({memberAccountId:member,inviteCode:invite.inviteCode});
  await assert.rejects(()=>adapter.teamAccessBegin(deviceId),/pro_team_membership_required/);
  teams.shareDevice({ownerAccountId:owner,deviceId,deviceOwnerAccountId:owner});
  const pending=await adapter.teamAccessBegin(deviceId,'OAuth member consent');
  assert(pending.requestId.startsWith('pa_')&&pending.pollToken&&pending.userCode);
  assert.equal(calls.at(-1).body.actorAccountId,member);
  assert.equal(calls.at(-1).body.agentId,expectedAgent);
  assert.equal(grants.requestInfo(pending.requestId).purpose,'team-member');
  assert.equal(grants.pendingForDevice(deviceId)[0].accountId,member);
  assert.equal(grants.recoverPairing({accountId:member,agentId:expectedAgent}),null,
    'member approval must NEVER be recovered as owner A/B device pairing');
  assert.throws(()=>grants.consumeRecoveredPairing({
    accountId:member,agentId:expectedAgent,requestId:pending.requestId}),/plus_authorization_not_found/);
  let status=await adapter.teamAccessPoll(pending);
  assert.equal(status.state,'pending');
  assert.equal(status.crossAccountExecutionEnabled,false);
  const spoof=new AccountOperatorAdapter({accountId:'owner',clientId},{teamOperatorCall:call});
  await assert.rejects(()=>spoof.teamAccessPoll(pending),/team_oauth_agent_mismatch/);
  const otherClient=new AccountOperatorAdapter({accountId:member,clientId:'other-client'},{teamOperatorCall:call});
  assert.notEqual(otherClient.agentId,expectedAgent);
  await assert.rejects(()=>otherClient.teamAccessPoll(pending),/team_oauth_agent_mismatch/);
  const approved=grants.approve(pending.requestId,{deviceId,connectionId:connection.connectionId,
    connectionExpiresAt:connection.hardExpiresAt});
  assert.equal(approved.accountId,member);
  assert.equal(approved.agentId,expectedAgent);
  status=await adapter.teamAccessPoll(pending);
  assert.equal(status.state,'approved');
  assert.equal(status.crossAccountExecutionEnabled,false);
  assert(!('grantId' in status),'MCP never returns bearer grant ID');
  assert(!('pollToken' in status),'MCP never returns raw poll token');
  assert(Number(status.accessExpiresAt)>Date.now());
  const again=await adapter.teamAccessPoll(pending);
  assert.equal(again.state,'approved','poll idempotent for same OAuth client while grant active');
  teams.unshareDevice({ownerAccountId:owner,deviceId});
  await assert.rejects(()=>adapter.teamAccessPoll(pending),/pro_team_membership_required/);
  teams.shareDevice({ownerAccountId:owner,deviceId,deviceOwnerAccountId:owner});
  plan='free';
  await assert.rejects(()=>adapter.teamAccessPoll(pending),/pro_team_membership_required/);
  plan='pro';
  teams.remove({ownerAccountId:owner,memberAccountId:member});
  await assert.rejects(()=>adapter.teamAccessPoll(pending),/pro_team_membership_required/);
  // Account page must not accept user-supplied OAuth identity.
  const portal=fs.readFileSync(new URL('../../plugin-server/account-portal.mjs',import.meta.url),'utf8');
  assert(portal.includes("team_approval_requires_oauth_plugin"));
  const tools=fs.readFileSync(new URL('../../plugin-server/tools.mjs',import.meta.url),'utf8');
  assert(tools.includes("process.env.LIGHT_REMOTE_PRO_TEAM_MCP_UAT==='1'"),
    'experimental tool is completely disabled by default');
  assert(tools.includes("light_remote_team_member_approval"));
  assert(tools.includes("title:'Request owner A/B approval for a shared Pro Team device (UAT)'"));
  const helperDescription=tools.match(/description:'Start here\. Handles Local Wall A\/B pairing[^']+'/)?.[0];
  assert(helperDescription,'existing helper metadata must not change');
  assert(!tools.includes("inputSchema:{deviceId:id.optional(),agentId"),
    'team MCP must never take caller-supplied agentId');
  console.log('team_oauth_verified_account_client_scopes=PASS');
  console.log('team_oauth_agent_id_not_caller_supplied=PASS');
  console.log('team_owner_b_approval_and_pending_to_approved=PASS');
  console.log('team_member_approval_never_recovers_as_owner_pairing=PASS');
  console.log('team_cross_client_and_cross_account_poll_denied=PASS');
  console.log('team_owner_unshare_downgrade_revoke_immediate_denial=PASS');
  console.log('team_oauth_mcp_disabled_by_default=PASS');
  console.log('team_cross_account_execution_remains_disabled=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
