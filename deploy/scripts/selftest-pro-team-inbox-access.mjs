import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rc50-team-inbox-'));
let now=Date.now(),plan='pro',active=true,verified=false;
const secret=Buffer.alloc(32, 0xb7);
const accounts=new Map([
 ['owner','owner@example.com'],['existing','user@example.com'],['stranger','stranger@example.com'],['later','later@example.com']
]);
const opts={stateFile:path.join(dir,'team.json'),now:()=>now,
 planFor:id=>id==='owner'?plan:'free',accountActive:()=>active,
 emailFor:id=>!verified&&id==='later'?null:accounts.get(id),
 inviteKey:secret};
const reg=new ProTeamRegistry(opts);
const deps={proTeams:reg,requireAccount:req=>{
 const id=req.headers?.authorization;if(!id||!accounts.has(id))throw Error('account_session_required');
 return {account:{accountId:id,email:accounts.get(id)}};
},readJson:async r=>r.body??{},sendJson:(res,status,data)=>{res.status=status;res.json=data;return true}};
async function api(member,method,url,body={}){
 const response={};await handleAccountRoutes({method,headers:{authorization:member},body},
   response,new URL('http://local'+url),deps);
 return response;
}
try{
 assert.throws(()=>reg.create({ownerAccountId:'owner'}),/pro_team_addon_required/);
 const grant=reg.grantTeamAccess({ownerAccountId:'owner',validUntil:now+5*86400000,monthlyMemberCallBudget:5});
 assert.equal(grant.monthlyMemberCallBudget,5);
 reg.create({ownerAccountId:'owner'});
 assert.deepEqual((await api('owner','GET','/v1/accounts/team/inbox')).json.notifications,[]);
 const first=reg.inviteEmail({ownerAccountId:'owner',memberEmail:'user@example.com'});
 const second=reg.inviteEmail({ownerAccountId:'owner',memberEmail:'later@example.com'});
 const saved=fs.readFileSync(opts.stateFile,'utf8');
 assert(!saved.includes(first.inviteCode)&&!saved.includes(second.inviteCode),'raw invite codes must not be stored');
 assert(saved.includes('cipher'),'encrypted codes must persist');
 assert.equal(reg.inbox({memberAccountId:'later'}).notifications.length,0,'unverified account not entitled to view');
 let inbox=(await api('existing','GET','/v1/accounts/team/inbox')).json;
 assert.equal(inbox.notifications.length,1);
 assert.equal(inbox.unreadCount,1);
 const n=inbox.notifications[0];
 assert.equal(n.inviteCode,first.inviteCode);
 assert.throws(()=>reg.acceptInbox({memberAccountId:'stranger',notificationId:n.notificationId}),/team_notification_not_found/);
 assert.throws(()=>reg.readInbox({memberAccountId:'stranger',notificationId:n.notificationId}),/team_notification_not_found/);
 await api('existing','POST','/v1/accounts/team/inbox/read',{notificationId:n.notificationId});
 inbox=(await api('existing','GET','/v1/accounts/team/inbox')).json;
 assert.equal(inbox.unreadCount,0);
 const reopened=new ProTeamRegistry(opts);
 assert.equal(reopened.inbox({memberAccountId:'existing'}).unreadCount,0,'read state survives restart');
 assert.equal(reopened.inbox({memberAccountId:'existing'}).notifications[0].inviteCode,first.inviteCode);
 const accepted=await api('existing','POST','/v1/accounts/team/inbox/accept',{notificationId:n.notificationId});
 assert.equal(accepted.status,200);
 assert.equal(accepted.json.team.usedSeats,2);
 assert.equal(accepted.json.crossAccountExecutionEnabled,false);
 assert.equal(reg.inbox({memberAccountId:'existing'}).notifications.length,0,'accepted notification disappears');
 assert.throws(()=>reg.acceptInbox({memberAccountId:'existing',notificationId:n.notificationId}),/team_notification_not_found/);
 verified=true;
 assert.equal(reg.inbox({memberAccountId:'later'}).unreadCount,1,'invitation appears upon verified signup');
 const remaining=reg.inbox({memberAccountId:'later'}).notifications[0];
 assert.equal(remaining.inviteCode,second.inviteCode);
 plan='free';
 assert.equal(reg.inbox({memberAccountId:'later'}).unreadCount,0,'downgrade stops Team inbox');
 assert.throws(()=>reg.acceptInbox({memberAccountId:'later',notificationId:remaining.notificationId}),/pro_team_subscription_required/);
 plan='pro';
 reg.revokeTeamAccess('owner');
 assert.equal(reg.inbox({memberAccountId:'later'}).unreadCount,0,'Team add-on revocation stops access');
 assert.throws(()=>reg.acceptInbox({memberAccountId:'later',notificationId:remaining.notificationId}),/pro_team_addon_required/);
 reg.grantTeamAccess({ownerAccountId:'owner',validUntil:now+86400000,monthlyMemberCallBudget:5});
 assert.equal(reg.inbox({memberAccountId:'later'}).unreadCount,1);
 now+=2*86400000;
 assert.equal(reg.inbox({memberAccountId:'later'}).unreadCount,0,'expired grant stops Team');
 assert.throws(()=>reg.create({ownerAccountId:'owner'}),/pro_team_addon_required/);
 console.log('pro_team_inbox_identity_isolation_and_verified_email=PASS');
 console.log('pro_team_inbox_aes_gcm_persisted_copy_code=PASS');
 console.log('pro_team_inbox_read_restarts_and_accepts=PASS');
 console.log('pro_team_inbox_pending_invite_visible_after_signup=PASS');
 console.log('pro_team_separate_addon_downgrade_revocation_expiry=PASS');
 console.log('pro_team_account_api_inbox_authenticated=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
