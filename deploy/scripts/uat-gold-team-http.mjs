/** Gold Pro Team real API UAT, scoped to synthetic example.invalid members.
 * Run in isolated Gold LXD as gold-uat, stages setup | exercise | read | cleanup-api.
 * No real email delivery: invite business endpoint called via private Operator socket.
 * Cleanup of synthetic accounts/rows must occur under stopped Gold writers separately.
 */
import assert from 'node:assert/strict';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {callOperatorJson} from '../../plugin-server/operator-client.mjs';
const stage=String(process.env.GOLD_TEAM_HTTP_STAGE||'');
assert.ok(['setup','exercise','finish','read','cleanup-api'].includes(stage),'team_stage_required');
assert.equal(process.env.LR_GOLD_INSTANCE_ID,'uat19','gold_instance_required');
assert.equal(process.env.LIGHT_REMOTE_GOLD_INDEPENDENT,'1');
const gold=await connectGoldStorage(),pool=gold.pool;
const origin='https://gold.light-remote.thaiduy.digital',host='gold.light-remote.thaiduy.digital';
const ownerEmail='gold-native-uat-20261019@example.invalid';
const ownerPass=String(process.env.GOLD_TEAM_HTTP_OWNER_PASSWORD||'');
const pw=String(process.env.GOLD_TEAM_HTTP_MEMBER_PASSWORD||'');
if(stage!=='setup'&&!ownerPass)throw Error('gold_team_http_owner_credential_required');
if(!pw||pw.length<10)throw Error('gold_team_http_member_credential_required');
const emails=Array.from({length:5},(_,i)=>'gold-team-http-uat-m'+(i+1)+'@example.invalid');
const counts=async(table)=>Number((await pool.query('SELECT count(*)::int AS n FROM '+table)).rows[0].n);
async function account(email){
 const q=await pool.query('SELECT account_id,plan FROM lr_accounts WHERE email=$1',[email]);assert.equal(q.rowCount,1,'account_missing:'+email);return q.rows[0];
}
async function post(url,body){return callOperatorJson('POST',url,body)}
async function login(email,password){
 const r=await fetch(origin+'/account/api?action=login',{method:'POST',headers:{Host:host,Origin:'https://'+host,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 const data=await r.json();assert.equal(r.status,200,'login:'+email+':'+JSON.stringify(data).slice(0,80));
 const cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie,'login_cookie_required');
 return cookie;
}
async function api(cookie,action,body){
 const method=body===undefined?'GET':'POST';
 const r=await fetch(origin+'/account/api?action='+action,{method,headers:{Host:host,Origin:'https://'+host,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,value:await r.json()};
}
function expectStatus(r,code,name){assert.equal(r.status,code,name+':'+JSON.stringify(r.value).slice(0,160));return r.value;}
async function fail(fn,code,pattern,label){
 try{await fn();assert.fail('expected failure:'+label)}catch(e){
  if(e.code==='ERR_ASSERTION')throw e;
  assert.equal(e.status,code,label+':'+e.message);
  assert.match(e.message,pattern,label);
 }
}
try{
 if(stage==='setup'){
  assert.equal(await counts('lr_teams'),0,'existing_team_data_refuse_setup');
  for(const email of emails){
   assert.equal((await pool.query('SELECT count(*)::int AS n FROM lr_accounts WHERE email=$1',[email])).rows[0].n,0,'fixture_preexists');
   const challenge=await post('/v1/plugin/accounts/register',{email,password:pw});
   assert.ok(challenge.pending?.pendingId&&challenge.token,'pending_registration_missing');
   const verified=await post('/v1/plugin/accounts/registration/verify',{pendingId:challenge.pending.pendingId,token:challenge.token,issueSession:false});
   assert.equal(verified.account?.email,email);
   assert.equal(verified.account?.emailVerified,true,'member_must_be_verified');
  }
  assert.equal((await account(ownerEmail)).plan,'pro');
  console.log('GOLD_TEAM_REAL_HTTP_FIXTURE_SETUP=PASS');
 }else if(stage==='exercise'){
  const owner=(await account(ownerEmail)).account_id,ownerCookie=await login(ownerEmail,ownerPass);
  const privateTeamInvite=async body=>callOperatorJson('POST','/v1/accounts/team/invite',body,{'x-light-account-session':decodeURIComponent(ownerCookie.split('=')[1])});
  const ms=await Promise.all(emails.map(email=>account(email)));
  const cookies=[];
  for(const email of emails)cookies.push(await login(email,pw));
  let r;
  if(process.env.GOLD_TEAM_RESUME==='1'){
    r=await api(ownerCookie,'team-entitlement');assert.equal(expectStatus(r,200,'resumed_entitlement').teamEntitlement.active,true);
    r=await api(ownerCookie,'team-view');assert.equal(expectStatus(r,200,'resumed_team').team.usedSeats,1);
  }else{
    r=await api(ownerCookie,'team-entitlement');assert.equal(expectStatus(r,200,'initial_entitlement').teamEntitlement.active,false);
    r=await api(ownerCookie,'team-create',{});assert.equal(r.status,403,'pro_alone_must_not_enable_team');
    const ent=await post('/v1/admin/accounts/'+owner+'/team-entitlement',{validUntil:Date.now()+2*86400000,monthlyMemberCallBudget:5000,source:'gold-team-http-uat-20261019'});
    assert.equal(ent.grant?.active,true,'addon_grant_not_active');
    r=await api(ownerCookie,'team-create',{});assert.equal(expectStatus(r,201,'create_team').team.usedSeats,1);
    r=await api(ownerCookie,'team-view');assert.equal(expectStatus(r,200,'view_team').team.seatLimit,5);
  }
  // No SMTP: direct private canonical Operator business route still creates encrypted invite and persists in PG.
  const emailInvite=await privateTeamInvite({memberEmail:emails[0]},{});
  assert.ok(emailInvite.invite?.inviteCode,'email_invite_not_created');
  r=await api(cookies[0],'team-inbox');const inbox=expectStatus(r,200,'member_inbox');
  assert.equal(inbox.unreadCount,1);
  assert.equal(inbox.notifications.length,1);
  assert.ok(inbox.notifications[0].inviteCode,'encrypted_inbox_invite_missing');
  r=await api(cookies[1],'team-inbox-accept',{notificationId:inbox.notifications[0].notificationId});assert.equal(r.status,404,'wrong_member_cannot_accept_invite');
  r=await api(cookies[0],'team-inbox-read',{notificationId:inbox.notifications[0].notificationId});expectStatus(r,200,'mark_read');
  r=await api(cookies[0],'team-inbox-accept',{notificationId:inbox.notifications[0].notificationId});
  assert.equal(expectStatus(r,200,'accept_verified_email').team.usedSeats,2);
  const invites=[];
  for(let i=1;i<=3;i++){
   const j=await privateTeamInvite({memberAccountId:ms[i].account_id});assert.ok(j.invite?.inviteCode);invites.push(j.invite.inviteCode);
  }
  await fail(()=>privateTeamInvite({memberAccountId:ms[4].account_id}),429,/seat_limit/,'pending_invites_reserve_seats');
  r=await api(cookies[4],'team-accept',{inviteCode:invites[0]});assert.equal(r.status,403,'invite_bound_to_target_member');
  for(let i=1;i<=3;i++){r=await api(cookies[i],'team-accept',{inviteCode:invites[i-1]});expectStatus(r,200,'member_accept_'+i);}
  r=await api(ownerCookie,'team-view');assert.equal(expectStatus(r,200,'team_full').team.usedSeats,5);
  await fail(()=>privateTeamInvite({memberAccountId:ms[4].account_id}),429,/seat_limit/,'full_team_rejects_invites');
  const deviceId='gold_20261019_device';
  r=await api(ownerCookie,'team-device-share',{deviceId});
  assert.ok(expectStatus(r,200,'share_owner_device').team.devices.includes(deviceId));
  r=await api(cookies[1],'team-memberships');const membership=expectStatus(r,200,'member_view').memberships;
  assert.equal(membership.length,1);assert.deepEqual(membership[0].sharedDevices,[deviceId]);
  assert.equal(membership[0].crossAccountExecutionEnabled,false);
  r=await api(cookies[1],'team-access-request',{deviceId});
  assert.equal(r.status,409,'browser_must_not_impersonate_chatgpt_oauth_agent');
  r=await api(ownerCookie,'team-remove',{memberAccountId:owner});
  assert.equal(r.status,403,'owner_cannot_remove_self');
  r=await api(ownerCookie,'team-remove',{memberAccountId:ms[3].account_id});
  assert.equal(expectStatus(r,200,'remove_member').team.usedSeats,4);
  const replacement=await privateTeamInvite({memberAccountId:ms[4].account_id});
  r=await api(cookies[4],'team-accept',{inviteCode:replacement.invite.inviteCode});
  assert.equal(expectStatus(r,200,'replace_seat').team.usedSeats,5);
  r=await api(ownerCookie,'team-device-unshare',{deviceId});
  assert.equal(expectStatus(r,200,'unshare').team.devices.length,0);
  assert.equal(await counts('lr_teams'),1);
  assert.equal(await counts('lr_team_members'),5);
  assert.equal(await counts('lr_gold_team_entitlements'),1);
  console.log('GOLD_TEAM_REAL_HTTP_CREATE_INVITE_INBOX_SEATS_SHARE_REVOKE=PASS');
 }else if(stage==='finish'){
  const ownerCookie=await login(ownerEmail,ownerPass);
  const accounts=await Promise.all(emails.map(email=>account(email)));
  let r=await api(ownerCookie,'team-view');
  assert.equal(expectStatus(r,200,'resume_before_last_seat').team.usedSeats,4);
  assert.deepEqual(r.value.team.devices,['gold_20261019_device']);
  assert.equal(r.value.team.members.includes(accounts[3].account_id),false,'removed_member_still_has_seat');
  const ownerToken=decodeURIComponent(ownerCookie.split('=')[1]);
  const invite=await callOperatorJson('POST','/v1/accounts/team/invite',
    {memberAccountId:accounts[4].account_id},{'x-light-account-session':ownerToken});
  assert.ok(invite.invite?.inviteCode);
  const newCookie=await login(emails[4],pw);
  r=await api(newCookie,'team-accept',{inviteCode:invite.invite.inviteCode});
  assert.equal(expectStatus(r,200,'replace_seat').team.usedSeats,5);
  r=await api(ownerCookie,'team-device-unshare',{deviceId:'gold_20261019_device'});
  assert.equal(expectStatus(r,200,'unshare_shared_device').team.devices.length,0);
  assert.equal(await counts('lr_team_members'),5);
  assert.equal(await counts('lr_gold_team_shared_devices'),0);
  console.log('GOLD_TEAM_REAL_HTTP_SEAT_REPLACEMENT_UNSHARE=PASS');
 }else if(stage==='read'){
  const cookie=await login(ownerEmail,ownerPass),r=await api(cookie,'team-view');
  assert.equal(expectStatus(r,200,'read_after_restart').team.usedSeats,5);
  assert.equal(r.value.team.devices.length,0);
  assert.equal((await api(cookie,'team-entitlement')).value.teamEntitlement.active,true);
  assert.equal(await counts('lr_team_members'),5);
  console.log('GOLD_TEAM_REAL_HTTP_AFTER_RESTART=PASS');
 }else{
  const cookie=await login(ownerEmail,ownerPass),owner=(await account(ownerEmail)).account_id;
  let r=await api(cookie,'team-view');assert.equal(expectStatus(r,200,'before_cleanup').team.usedSeats,5);
  for(const member of r.value.team.members.filter(x=>x!==owner)){
   r=await api(cookie,'team-remove',{memberAccountId:member});expectStatus(r,200,'cleanup_member');
  }
  const out=await callOperatorJson('DELETE','/v1/admin/accounts/'+owner+'/team-entitlement',{expectedSource:'gold-team-http-uat-20261019'});
  assert.equal(out.revoked,true,'team_entitlement_not_revoked');
  r=await api(cookie,'team-entitlement');assert.equal(expectStatus(r,200,'after_addon_revoke').teamEntitlement.active,false);
  r=await api(cookie,'team-create',{});assert.equal(r.status,403,'addon_revoke_blocks_create');
  console.log('GOLD_TEAM_REAL_HTTP_REVOKE_ADDON=PASS');
 }
}finally{await gold.close()}
