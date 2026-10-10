import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc50-email-invite-'));
let now=Date.now();
let ownerPlan='pro';
const accounts=new Map([
  ['owner',{email:'owner@example.com',verified:true,active:true}],
  ['member',{email:'member@example.com',verified:true,active:true}],
  ['unverified',{email:'invitee@example.com',verified:false,active:true}],
  ['outsider',{email:'other@example.com',verified:true,active:true}],
]);
const emailFor=id=>{const a=accounts.get(id);return a?.verified?a.email:null;};
const opts={stateFile:path.join(dir,'teams.json'),now:()=>now,
  planFor:id=>id==='owner'?ownerPlan:'free',
  accountActive:id=>accounts.get(id)?.active===true,emailFor,inviteKey:Buffer.alloc(32,42)};
const team=new ProTeamRegistry(opts);
try{
 team.grantTeamAccess({ownerAccountId:'owner',validUntil:now+30*86400000});
 team.create({ownerAccountId:'owner'});
 assert.deepEqual(team.memberships('owner'),[],'owner must not be displayed as joined member');
 assert.throws(()=>team.inviteEmail({ownerAccountId:'owner',memberEmail:'invalid'}),/invalid_team_invite_email/);
 assert.throws(()=>team.inviteEmail({ownerAccountId:'owner',memberEmail:'OWNER@example.com'}),/team_member_already_joined/);
 const emailInvite=team.inviteEmail({ownerAccountId:'owner',memberEmail:'  INVITEE@EXAMPLE.COM  '});
 assert.equal(emailInvite.expiresAt-now,24*60*60*1000);
 assert.throws(()=>team.accept({memberAccountId:'member',inviteCode:emailInvite.inviteCode}),/team_invite_invalid/);
 assert.throws(()=>team.accept({memberAccountId:'unverified',inviteCode:emailInvite.inviteCode}),/team_invite_invalid/);
 assert.throws(()=>team.inviteEmail({ownerAccountId:'owner',memberEmail:'invitee@example.com'}),/team_invite_cooldown/);
 now+=61_000;
 const replacement=team.inviteEmail({ownerAccountId:'owner',memberEmail:'invitee@example.com'});
 assert.notEqual(replacement.inviteCode,emailInvite.inviteCode);
 assert.throws(()=>team.accept({memberAccountId:'unverified',inviteCode:emailInvite.inviteCode}),/team_invite_invalid/);
 let restored=new ProTeamRegistry(opts);
 assert.equal(restored.invites.size,1);
 assert.throws(()=>restored.accept({memberAccountId:'unverified',inviteCode:replacement.inviteCode}),/team_invite_invalid/);
 accounts.get('unverified').verified=true;
 assert.equal(restored.accept({memberAccountId:'unverified',inviteCode:replacement.inviteCode}).usedSeats,2);
 assert.throws(()=>restored.accept({memberAccountId:'unverified',inviteCode:replacement.inviteCode}),/team_invite_invalid/);
 assert.throws(()=>restored.inviteEmail({ownerAccountId:'owner',memberEmail:'INVITEE@example.com'}),/team_member_already_joined/);
 assert.equal(restored.memberships('owner').length,0);
 assert.equal(restored.memberships('unverified').length,1);

 const unknown=restored.inviteEmail({ownerAccountId:'owner',memberEmail:'not-yet-registered@example.com'});
 assert(unknown.inviteCode);
 accounts.set('newmember',{email:'not-yet-registered@example.com',verified:true,active:true});
 assert.equal(restored.accept({memberAccountId:'newmember',inviteCode:unknown.inviteCode}).usedSeats,3);
 assert.throws(()=>restored.inviteEmail({ownerAccountId:'owner',memberEmail:'not-yet-registered@example.com'}),/team_member_already_joined/);

 const expired=restored.inviteEmail({ownerAccountId:'owner',memberEmail:'late@example.com'});
 now+=24*60*60*1000+1;
 accounts.set('late',{email:'late@example.com',verified:true,active:true});
 assert.throws(()=>restored.accept({memberAccountId:'late',inviteCode:expired.inviteCode}),/team_invite_invalid/);
 assert.equal(restored.view('owner').usedSeats,3);
 ownerPlan='free';
 assert.throws(()=>restored.inviteEmail({ownerAccountId:'owner',memberEmail:'new@example.com'}),/pro_team_subscription_required/);
 assert.deepEqual(restored.memberships('unverified'),[]);
 ownerPlan='pro';

 const pendingA=restored.inviteEmail({ownerAccountId:'owner',memberEmail:'one@example.com'});
 const pendingB=restored.inviteEmail({ownerAccountId:'owner',memberEmail:'two@example.com'});
 assert(pendingA.inviteCode);
 assert(pendingB.inviteCode);
 assert.throws(()=>restored.inviteEmail({ownerAccountId:'owner',memberEmail:'three@example.com'}),/team_seat_limit/);

 // Verify authenticated Operator boundary selects email based invitation without lookup.
 const tokenAccounts={ownertoken:'owner',outsidertoken:'outsider'};
 const deps={
   AccountError:class AccountError extends Error{constructor(message,status=403){super(message);this.status=status}},
   accounts:{assertOperational:id=>{if(!accounts.has(id))throw Error('account_not_found');return {accountId:id}}},
   proTeams:restored,
   requireAccount:req=>{const id=tokenAccounts[req.headers?.authorization];if(!id)throw Error('account_session_required');return {account:{accountId:id}}},
   readJson:async req=>req.body||{},
   sendJson:(res,status,data)=>{res.status=status;res.data=data;return true}
 };
 const call=async body=>{
   const response={};
   await handleAccountRoutes({method:'POST',body,headers:{authorization:'ownertoken'}},response,new URL('http://local/v1/accounts/team/invite'),deps);
   return response;
 };
 // Seat already full; no account lookup should occur and cap fails closed.
 await assert.rejects(()=>call({memberEmail:'anyone@example.com'}),/team_seat_limit/);
 await assert.rejects(()=>call({memberEmail:'anyone@example.com',memberAccountId:'outsider'}),/invalid_team_invitee/);
 // Successful authenticated operator route does not require exposing account ID.
 const fresh=new ProTeamRegistry({...opts,stateFile:path.join(dir,'api-invites.json')});
 fresh.grantTeamAccess({ownerAccountId:'owner',validUntil:now+30*86400000});
 fresh.create({ownerAccountId:'owner'});
 deps.proTeams=fresh;
 const apiInvite=await call({memberEmail:'NEW-COLLEAGUE@EXAMPLE.COM'});
 assert.equal(apiInvite.status,201);
 assert(apiInvite.data.invite.inviteCode);
 accounts.set('apiMember',{email:'new-colleague@example.com',verified:true,active:true});
 assert.equal(fresh.accept({memberAccountId:'apiMember',inviteCode:apiInvite.data.invite.inviteCode}).usedSeats,2);
 // Persisted rate limits prevent repeated invites from an owner after restart.
 const limited=new ProTeamRegistry({...opts,stateFile:path.join(dir,'daily-limit.json')});
 limited.grantTeamAccess({ownerAccountId:'owner',validUntil:now+30*86400000});
 limited.create({ownerAccountId:'owner'});
 for(let n=0;n<12;n++){
   limited.inviteEmail({ownerAccountId:'owner',memberEmail:'limited@example.com'});
   now+=61_000;
 }
 const limitReloaded=new ProTeamRegistry({...opts,stateFile:path.join(dir,'daily-limit.json')});
 assert.throws(()=>limitReloaded.inviteEmail({ownerAccountId:'owner',memberEmail:'limited@example.com'}),/team_invite_rate_limited/);
 now+=24*60*60*1000+1;
 assert(limitReloaded.inviteEmail({ownerAccountId:'owner',memberEmail:'limited@example.com'}).inviteCode);
 assert.equal(fs.existsSync(opts.stateFile),true);
 console.log('email_invites_existing_and_unregistered_accounts=PASS');
 console.log('email_invites_verified_email_claim_prevents_hijack=PASS');
 console.log('email_invites_persist_single_use_and_expire=PASS');
 console.log('email_invite_cooldown_and_seat_limit=PASS');
 console.log('owner_not_listed_as_joined_member=PASS');
 console.log('email_invite_operator_route_account_session=PASS');
 console.log('email_invite_persisted_owner_daily_rate_limit=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
