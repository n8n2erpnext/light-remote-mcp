import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldPgTeamUsageAuthority} from '../src/storage/gold-team-usage-authority.mjs';
const OWNER='acct_owner',MEMBER='acct_member',DEVICE='dev_test',TEAM='team_test';
const EVIDENCE={eventId:'evt_0001',ownerAccountId:OWNER,actorAccountId:OWNER,
 deviceId:DEVICE,grantId:'grant_0001',calls:1};
const date=Date.parse('2026-10-17T10:00:00Z');
function fixture({accountId=OWNER,email='owner@example.test',evidence=EVIDENCE,proof=true,
 response=async()=>({rows:[]})}={}){
 const log=[],core={authenticate:async()=>({accountId,email})};
 const query=async(sql,params=[])=>{
  log.push({sql,params});
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql)||sql.startsWith('SELECT pg_advisory_xact_lock'))
   return {rows:[]};
  return response(sql,params);
 };
 const pool={query,connect:async()=>({query,release:()=>{}})};
 const svc=new GoldPgTeamUsageAuthority({pool,core,now:()=>date,
  verifyOwnerProof:async()=>proof,
  verifyUsageEvidence:async()=>evidence});
 return{svc,log};
}
test('Team and usage constructors require real PG and trusted verifiers',()=>{
 assert.throws(()=>new GoldPgTeamUsageAuthority({}),/gold_team_pg_pool_required/);
 assert.throws(()=>new GoldPgTeamUsageAuthority({
  pool:{query(){},connect(){}}}),/gold_team_trusted_authority_required/);
});
test('Pro Team creation takes account lock, writes team + owner seat atomically',async()=>{
 const {svc,log}=fixture({response:async(sql,p)=>{
  if(sql.includes('AS active_entitlement FROM lr_accounts a'))return{rows:[{plan:'pro',status:'active',active_entitlement:true}]};
  if(sql.includes('INSERT INTO lr_teams('))return{rows:[{team_id:p[0]}]};
  return{rows:[]};
 }});
 const result=await svc.createTeam({sessionToken:'s',proof:'root'});
 assert.equal(result.ownerAccountId,OWNER);assert.equal(result.seatCap,5);
 assert(log.some(x=>x.sql==='BEGIN'));
 assert(log.some(x=>x.sql.includes("VALUES($1,$2,'active')")));
 assert.equal(log.at(-1).sql,'COMMIT');
 const denied=fixture({proof:false});
 await assert.rejects(()=>denied.svc.createTeam({sessionToken:'s'}),
  /gold_team_owner_proof_required/);
 assert.equal(denied.log.length,0);
});
test('Team invitation accepts only verified recipient, locks seat cap and consumes hash once',async()=>{
 let issued=null,accepted=false;
 const {svc,log}=fixture({response:async(sql,p)=>{
  if(sql.startsWith('SELECT status,email,email_verified FROM lr_accounts'))
   return{rows:[{status:'active',email:'member@example.test',email_verified:true}]};
  if(sql.startsWith('SELECT owner_account_id,seat_cap FROM lr_teams'))
   return{rows:[{owner_account_id:OWNER,seat_cap:5}]};
  if(sql.includes('COUNT(*)::integer AS count FROM lr_team_members'))
   return{rows:[{count:1}]};
  if(sql.startsWith('INSERT INTO lr_team_invites(')){
   issued={sha:p[0],email:p[2],expiresAt:new Date(p[3])};
   return{rows:[{invite_sha256:issued.sha}]};
  }
  if(sql.startsWith('SELECT invite_sha256,team_id')){
   return{rows:[{invite_sha256:issued.sha,team_id:TEAM,
    recipient_email:issued.email,expires_at:issued.expiresAt,
    accepted_at:accepted?new Date():null}]};
  }
  if(sql.startsWith('UPDATE lr_team_invites SET')){
   accepted=true;return{rows:[{invite_sha256:issued.sha}]};
  }
  return{rows:[]};
 }});
 const invite=await svc.inviteMember({sessionToken:'owner',teamId:TEAM,
  recipientEmail:'member@example.test',proof:'signed'});
 assert(invite.inviteCode.length>40);
 assert.notEqual(invite.inviteCode,issued.sha);
 svc.core.authenticate=async()=>({accountId:MEMBER,email:'member@example.test'});
 const joined=await svc.acceptInvite({sessionToken:'member',inviteCode:invite.inviteCode});
 assert.equal(joined.memberAccountId,MEMBER);
 assert(accepted);
 await assert.rejects(()=>svc.acceptInvite({sessionToken:'member',inviteCode:invite.inviteCode}),
  /gold_team_invite_invalid_or_consumed/);
 assert(log.some(x=>x.sql.includes("ON CONFLICT(team_id,account_id) DO UPDATE")));
});
test('Sharing and revoking Team access updates durable membership and closes all issued grants',async()=>{
 const {svc,log}=fixture({response:async(sql)=>{
  if(sql.includes('SELECT t.team_id FROM lr_teams t JOIN lr_devices d'))
   return{rows:[{team_id:TEAM}]};
  if(sql.startsWith('SELECT owner_account_id FROM lr_teams'))
   return{rows:[{owner_account_id:OWNER}]};
  if(sql.startsWith('UPDATE lr_team_members SET'))
   return{rows:[{account_id:MEMBER}]};
  return{rows:[]};
 }});
 assert((await svc.shareDevice({sessionToken:'s',teamId:TEAM,deviceId:DEVICE,proof:'signed'})).shared);
 const result=await svc.removeMember({sessionToken:'s',teamId:TEAM,
  memberAccountId:MEMBER,proof:'signed'});
 assert(result.revoked);
 assert(log.some(x=>x.sql.includes('UPDATE lr_ab_grants SET closed_at=now()')));
 const denied=fixture({proof:false});
 await assert.rejects(()=>denied.svc.shareDevice({sessionToken:'s',
  teamId:TEAM,deviceId:DEVICE}),/gold_team_share_owner_proof_required/);
});
test('Owner usage charge checks signed event, live AB grant and budget before SQL insertion',async()=>{
 let event=null;
 const {svc,log}=fixture({response:async(sql,p)=>{
  if(sql.startsWith('SELECT event_id,owner_account_id,actor_account_id')){
   return{rows:event?[event]:[]};
  }
  if(sql.startsWith('SELECT a.account_id,a.plan,a.status'))
   return{rows:[{account_id:OWNER,plan:'free',status:'active',
    actor_status:'active',device_state:'online',device_owner:OWNER}]};
  if(sql.startsWith('SELECT g.grant_id FROM lr_ab_grants'))return{rows:[{grant_id:'grant_0001'}]};
  if(sql.startsWith('SELECT call_limit FROM lr_usage_budgets'))return{rows:[]};
  if(sql.startsWith('SELECT tool_calls FROM lr_usage_monthly'))return{rows:[{tool_calls:9999}]};
  if(sql.startsWith('INSERT INTO lr_usage_events(')){
   event={event_id:p[0],owner_account_id:p[1],actor_account_id:p[2],
    device_id:p[3],job_id:p[4],month_key:p[5],tool_calls:p[6]};
   return{rows:[]};
  }
  return{rows:[]};
 }});
 const result=await svc.chargeToolCall({signedEvent:{purpose:'signed'}});
 assert.equal(result.recorded,true);assert.equal(result.month,'2026-10');
 assert(log.some(x=>x.sql.includes('lr_usage_monthly.tool_calls+EXCLUDED.tool_calls')));
 assert.equal((await svc.chargeToolCall({signedEvent:{purpose:'signed'}})).duplicate,true);
 assert.equal(log.filter(x=>x.sql.startsWith('INSERT INTO lr_usage_events(')).length,1);
});
test('Usage denies absent signed evidence before querying PG, and rejects revoked AB grant',async()=>{
 const none=fixture({evidence:null});
 await assert.rejects(()=>none.svc.chargeToolCall({signedEvent:null}),
  /gold_usage_signed_evidence_required/);
 assert.equal(none.log.length,0);
 const denied=fixture({response:async(sql)=>{
  if(sql.startsWith('SELECT a.account_id,a.plan,a.status'))
   return{rows:[{account_id:OWNER,plan:'pro',status:'active',
    actor_status:'active',device_state:'online'}]};
  return{rows:[]};
 }});
 await assert.rejects(()=>denied.svc.chargeToolCall({signedEvent:'valid'}),
  /gold_usage_ab_grant_invalid/);
 assert(denied.log.some(x=>x.sql==='ROLLBACK'));
});
test('Team member charges require live membership, AB grant and explicit member budget',async()=>{
 const evidence={...EVIDENCE,actorAccountId:MEMBER};
 const {svc,log}=fixture({evidence,response:async(sql)=>{
  if(sql.startsWith('SELECT a.account_id,a.plan,a.status'))
   return{rows:[{account_id:OWNER,plan:'pro',status:'active',
    actor_status:'active',device_state:'online'}]};
  if(sql.startsWith('SELECT g.grant_id FROM lr_ab_grants'))
   return{rows:[{grant_id:'grant_0001'}]};
  if(sql.includes('FROM lr_teams t JOIN lr_team_members m'))
   return{rows:[{team_id:TEAM}]};
  if(sql.includes('FROM lr_team_member_budgets'))return{rows:[]};
  return{rows:[]};
 }});
 await assert.rejects(()=>svc.chargeToolCall({signedEvent:'verified'}),
  /gold_usage_team_budget_not_configured/);
 assert(!log.some(x=>x.sql.startsWith('INSERT INTO lr_usage_events(')));
 assert(log.some(x=>x.sql==='ROLLBACK'));
});
