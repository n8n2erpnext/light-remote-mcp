/**
 * Actual PostgreSQL 17/Redis 8 Pro Team UAT, isolated LXD only.
 * Usage: GOLD_TEAM_UAT_STAGE=preflight|write|read|cleanup node ...
 * Fails closed if any non-UAT Team data exists. No production account data.
 */
import assert from 'node:assert/strict';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldNativeProTeam} from '../../lib/gold-native-pro-team.mjs';

const stage=String(process.env.GOLD_TEAM_UAT_STAGE||'');
if(!['preflight','write','read','cleanup'].includes(stage))throw Error('gold_team_uat_stage_invalid');
const owner='acct_gold_team_20261019_owner',member='acct_gold_team_20261019_member';
const hash='e'.repeat(64);
const emailDomain='example.invalid';
const now=Date.now();
const db=await connectGoldStorage();
const {pool}=db;
const tables=['lr_teams','lr_team_members','lr_gold_team_shared_devices','lr_gold_team_entitlements','lr_gold_team_invite_codes','lr_gold_team_notification_reads','lr_gold_team_email_invite_events'];
const counts=async()=>{
 const result={};
 for(const name of tables){
  result[name]=Number((await pool.query('SELECT count(*)::int AS n FROM '+name)).rows[0].n);
 }
 return result;
};
const expectedOwner=async()=>Number((await pool.query('SELECT count(*)::int AS n FROM lr_accounts WHERE account_id IN ($1,$2)',[owner,member])).rows[0].n);
try{
 const before=await counts();
 if(stage==='preflight'){
  console.log('GOLD_TEAM_UAT_PREFLIGHT',JSON.stringify(before));
 }else if(stage==='write'){
  if(Object.values(before).some(x=>x!==0)||await expectedOwner()!==0)
   throw Error('gold_team_uat_refuse_existing_state');
  for(const [id,mail,plan] of [[owner,'gold-team-owner-20261019@'+emailDomain,'pro'],[member,'gold-team-member-20261019@'+emailDomain,'free']]){
   await pool.query('INSERT INTO lr_accounts(account_id,email,plan,status) VALUES($1,$2,$3,$4)',[id,mail,plan,'active']);
  }
  const adapter=await GoldNativeProTeam.open({pool});
  await adapter.store.write({
   schemaVersion:1,
   teams:[[owner,{ownerAccountId:owner,members:[owner,member],devices:[],createdAt:now}]],
   teamGrants:[[owner,{ownerAccountId:owner,validUntil:now+86400000,monthlyMemberCallBudget:5000,source:'isolated-uat'}]],
   invites:[[hash,{hash,ownerAccountId:owner,memberAccountId:member,expiresAt:now+3600000}]],
   notificationReads:[[member+':'+hash,{accountId:member,hash,readAt:now}]],
   emailInviteEvents:[{ownerAccountId:owner,memberEmail:'gold-team-member-20261019@'+emailDomain,issuedAt:now}]
  });
  const after=await counts();
  assert.equal(after.lr_teams,1);assert.equal(after.lr_team_members,2);
  assert.equal(after.lr_gold_team_entitlements,1);assert.equal(after.lr_gold_team_invite_codes,1);
  assert.equal(after.lr_gold_team_notification_reads,1);
  assert.equal(after.lr_gold_team_email_invite_events,1);
  const loaded=await GoldNativeProTeam.open({pool});
  assert.deepEqual(loaded.data.teams[0][1].members.slice().sort(),[member,owner].sort());
  assert.equal(loaded.data.teamGrants[0][1].monthlyMemberCallBudget,5000);
  console.log('GOLD_TEAM_REAL_PG17_WRITE_AND_READ=PASS');
 }else if(stage==='read'){
  const loaded=await GoldNativeProTeam.open({pool});
  assert.equal(await expectedOwner(),2);
  const team=loaded.data.teams.find(([key])=>key===owner)?.[1];
  assert.ok(team);assert.deepEqual(team.members.slice().sort(),[member,owner].sort());
  assert.equal(loaded.data.teamGrants.find(([key])=>key===owner)?.[1]?.monthlyMemberCallBudget,5000);
  assert.equal(loaded.data.invites.find(([key])=>key===hash)?.[1]?.memberAccountId,member);
  assert.equal(loaded.data.notificationReads.find(([key])=>key===member+':'+hash)?.[1]?.hash,hash);
  assert.equal(loaded.data.emailInviteEvents.filter(x=>x.ownerAccountId===owner).length,1);
  console.log('GOLD_TEAM_REAL_PG17_AFTER_RESTART=PASS');
 }else if(stage==='cleanup'){
  const actual=await counts();
  if(actual.lr_teams!==1||actual.lr_team_members!==2||actual.lr_gold_team_entitlements!==1||
     actual.lr_gold_team_invite_codes!==1||actual.lr_gold_team_notification_reads!==1||actual.lr_gold_team_email_invite_events!==1||
     await expectedOwner()!==2)throw Error('gold_team_uat_cleanup_aborted_unexpected_state');
  const adapter=await GoldNativeProTeam.open({pool});
  await adapter.store.write({schemaVersion:1,teams:[],teamGrants:[],invites:[],notificationReads:[],emailInviteEvents:[]});
  await pool.query('DELETE FROM lr_accounts WHERE account_id IN ($1,$2)',[owner,member]);
  if(Object.values(await counts()).some(Boolean)||await expectedOwner()!==0)
   throw Error('gold_team_uat_cleanup_failed');
  console.log('GOLD_TEAM_REAL_PG17_CLEANUP=PASS');
 }
}finally{await db.close()}
