import assert from 'node:assert/strict';
import {GoldNativeProTeam} from '../../lib/gold-native-pro-team.mjs';
import {GoldNativeLicense} from '../../lib/gold-native-license.mjs';

const seen=[];
const state={teams:[],members:[],devices:[],grants:[],invites:[],reads:[],events:[],licenses:[],redemptions:[]};
const pool={
 async connect(){return {query:query,release(){}}},
 query
};
async function query(sql,args=[]){
 seen.push(sql);
 if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
 if(sql.startsWith('SELECT team_id,owner_account_id,created_at FROM lr_teams'))return {rows:structuredClone(state.teams)};
 if(sql.startsWith('SELECT team_id,account_id FROM lr_team_members'))return {rows:structuredClone(state.members)};
 if(sql.startsWith('SELECT team_id,device_id FROM lr_gold_team_shared_devices'))return {rows:structuredClone(state.devices)};
 if(sql.startsWith('SELECT * FROM lr_gold_team_entitlements'))return {rows:structuredClone(state.grants)};
 if(sql.startsWith('SELECT * FROM lr_gold_team_invite_codes'))return {rows:structuredClone(state.invites)};
 if(sql.startsWith('SELECT * FROM lr_gold_team_notification_reads'))return {rows:structuredClone(state.reads)};
 if(sql.startsWith('SELECT owner_account_id,member_email,issued_ms FROM lr_gold_team_email_invite_events'))return {rows:structuredClone(state.events)};
 if(sql.startsWith('SELECT * FROM lr_gold_license_keys'))return {rows:structuredClone(state.licenses)};
 if(sql.startsWith('SELECT license_id,account_id,redeemed_ms FROM lr_gold_license_redemptions'))return {rows:structuredClone(state.redemptions)};
 const del=[
 ['lr_gold_team_shared_devices','devices'],['lr_team_members','members'],
 ['lr_gold_team_invite_codes','invites'],['lr_gold_team_notification_reads','reads'],
 ['lr_gold_team_entitlements','grants'],['lr_gold_team_email_invite_events','events'],
 ['lr_gold_license_redemptions','redemptions']
 ];
 for(const [name,key]of del)if(sql==='DELETE FROM '+name){state[key]=[];return {rows:[]}};
 if(sql.startsWith('DELETE FROM lr_teams')){state.teams=state.teams.filter(x=>args[0]?.includes(x.team_id));return {rows:[]}};
 if(sql.startsWith('DELETE FROM lr_gold_license_keys')){state.licenses=state.licenses.filter(x=>args[0]?.includes(x.license_id));return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_teams')){state.teams.push({team_id:args[0],owner_account_id:args[1],created_at:args[2]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_team_members')){state.members.push({team_id:args[0],account_id:args[1]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_team_shared_devices')){state.devices.push({team_id:args[0],device_id:args[1]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_team_invite_codes')){state.invites.push({code_sha256:args[0],owner_account_id:args[1],member_account_id:args[2],member_email:args[3],cipher:args[4],expires_ms:args[5]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_team_notification_reads')){state.reads.push({account_id:args[0],code_sha256:args[1],read_ms:args[2]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_team_entitlements')){state.grants.push({owner_account_id:args[0],valid_until_ms:args[1],monthly_member_call_budget:args[2],source:args[3]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_team_email_invite_events')){state.events.push({owner_account_id:args[0],member_email:args[1],issued_ms:args[2]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_license_keys')){state.licenses.push({license_id:args[0],key_sha256:args[1],last4:args[2],plan:args[3],duration_ms:args[4],max_redemptions:args[5],issued_ms:args[6],expires_ms:args[7],revoked_ms:args[8],revoke_reason:args[9],label:args[10]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_license_redemptions')){state.redemptions.push({license_id:args[0],account_id:args[1],redeemed_ms:args[2]});return {rows:[]}};
 throw Error('unexpected_sql:'+sql);
}
const team=await GoldNativeProTeam.open({pool});
const inviteHash='a'.repeat(64);
await team.store.write({
 teams:[['owner',{ownerAccountId:'owner',members:['owner','member'],devices:['device'],createdAt:1730000000000}]],
 teamGrants:[['owner',{ownerAccountId:'owner',validUntil:1900000000000,monthlyMemberCallBudget:5000,source:'test'}]],
 invites:[[inviteHash,{hash:inviteHash,ownerAccountId:'owner',memberAccountId:'member',expiresAt:1900000000000}]],
 notificationReads:[['member:'+inviteHash,{accountId:'member',hash:inviteHash,readAt:1730000000000}]],
 emailInviteEvents:[{ownerAccountId:'owner',memberEmail:'member@example.test',issuedAt:1730000000000}]
});
const reloaded=await GoldNativeProTeam.open({pool});
assert.equal(reloaded.data.teams[0][1].members.length,2);
assert.deepEqual(reloaded.data.teams[0][1].devices,['device']);
assert.equal(reloaded.data.teamGrants[0][1].monthlyMemberCallBudget,5000);
assert.equal(reloaded.data.invites[0][1].hash,inviteHash);
assert.equal(reloaded.data.notificationReads[0][1].readAt,1730000000000);
assert.equal(reloaded.data.emailInviteEvents.length,1);
const nativeLicense=await GoldNativeLicense.open({pool});
const keyHash='b'.repeat(64);
await nativeLicense.store.write(new Map([['license1',{
 licenseId:'license1',keyHash,last4:'ABCD',plan:'pro',durationMs:86400000,maxRedemptions:3,
 issuedAt:1730000000000,expiresAt:null,revokedAt:null,label:'test',
 redemptions:[{accountId:'member',redeemedAt:1730000000001}]
}]]));
const reloadedLicense=await GoldNativeLicense.open({pool});
assert.equal(reloadedLicense.rows[0][1].keyHash,keyHash);
assert.equal(reloadedLicense.rows[0][1].redemptions[0].accountId,'member');
assert.ok(seen.every(q=>!q.includes('jsonb')&&!q.includes('registry_documents')));
console.log('GOLD_NATIVE_TEAM_LICENSE_SQL_FAKE=PASS');
