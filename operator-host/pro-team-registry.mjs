import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_SEATS=5;
const INVITE_TTL_MS=15*60*1000;
const EMAIL_INVITE_TTL_MS=24*60*60*1000;
const EMAIL_INVITE_DAILY_LIMIT=12;
const DEFAULT_TEAM_CALL_BUDGET=5000;
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const valid=value=>/^[A-Za-z0-9._:-]{1,128}$/.test(String(value||''));
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
export class ProTeamError extends Error{constructor(message,status=403){super(message);this.status=status;}}
function checkId(id){if(!valid(id))throw new ProTeamError('invalid_team_account',400);return String(id);}
export class ProTeamRegistry {
  constructor({stateFile=null,now=()=>Date.now(),planFor=()=> 'free',accountActive=()=>true,emailFor=()=>null,inviteKey=null,onRevoke=()=>{}}={}){
    this.stateFile=stateFile;this.now=now;this.planFor=planFor;this.accountActive=accountActive;this.emailFor=emailFor;this.onRevoke=onRevoke;this.inviteKey=inviteKey?Buffer.from(inviteKey):null;
    if(this.inviteKey&&this.inviteKey.length!==32)throw new ProTeamError('invalid_invite_encryption_key',500);
    this.teams=new Map();this.invites=new Map();this.emailInviteEvents=[];this.teamGrants=new Map();this.notificationReads=new Map();
    if(stateFile&&fs.existsSync(stateFile)){
      const parsed=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(parsed.schemaVersion!==1)throw new ProTeamError('invalid_team_state',500);
      for(const team of parsed.teams||[])this.teams.set(team.ownerAccountId,team);
      for(const invite of parsed.invites||[])this.invites.set(invite.hash,invite);
      this.emailInviteEvents=Array.isArray(parsed.emailInviteEvents)?parsed.emailInviteEvents.filter(x=>Number.isFinite(x.issuedAt)):[];
      for(const grant of parsed.teamGrants||[])if(valid(grant.ownerAccountId))this.teamGrants.set(grant.ownerAccountId,grant);
      for(const row of parsed.notificationReads||[])if(row.accountId&&row.hash)this.notificationReads.set(row.accountId+':'+row.hash,row);
    }
  }
  _save(){if(!this.stateFile)return;fs.mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o750});const tmp=this.stateFile+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,teams:[...this.teams.values()],invites:[...this.invites.values()],emailInviteEvents:this.emailInviteEvents,teamGrants:[...this.teamGrants.values()],notificationReads:[...this.notificationReads.values()].slice(-5000)},null,2)+'\n',{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);}
  // A regular PRO account never receives Team by default. The account must
  // also have a separately issued owner-scoped TEAM entitlement. No pricing
  // or real billing happens here; an admin integration must issue/revoke it.
  grantTeamAccess({ownerAccountId,validUntil,monthlyMemberCallBudget=DEFAULT_TEAM_CALL_BUDGET,source='staging-uat'}={}){
    const owner=checkId(ownerAccountId),end=Number(validUntil),budget=Number(monthlyMemberCallBudget);
    if(!Number.isFinite(end)||end<=this.now()||!Number.isSafeInteger(budget)||budget<1||budget>1_000_000)
      throw new ProTeamError('invalid_team_entitlement',400);
    this.teamGrants.set(owner,{ownerAccountId:owner,validUntil:end,monthlyMemberCallBudget:budget,source:String(source).slice(0,70)});
    this._save();return this.teamEntitlement(owner);
  }
  revokeTeamAccess(ownerAccountId,{expectedSource=null}={}){
    const owner=checkId(ownerAccountId),current=this.teamGrants.get(owner);
    if(expectedSource!==null&&(!current||current.source!==expectedSource))return false;
    const deleted=this.teamGrants.delete(owner);
    if(deleted)this._save();
    return deleted;
  }
  teamEntitlement(ownerAccountId){
    const owner=checkId(ownerAccountId),grant=this.teamGrants.get(owner);
    const active=Boolean(grant&&grant.validUntil>this.now()&&
      ['pro','vip'].includes(String(this.planFor(owner)||'free').toLowerCase())&&this.accountActive(owner));
    return {active,validUntil:grant?.validUntil??null,
      monthlyMemberCallBudget:active?grant.monthlyMemberCallBudget:0,
      requiresAddOn:true};
  }
  _eligible(owner){
    if(!['pro','vip'].includes(String(this.planFor(owner)||'free').toLowerCase())||!this.accountActive(owner))
      throw new ProTeamError('pro_team_subscription_required');
    if(!this.teamEntitlement(owner).active)throw new ProTeamError('pro_team_addon_required');
  }
  _encryptCode(value){
    if(!this.inviteKey)throw new ProTeamError('team_inbox_key_not_configured',503);
    const iv=crypto.randomBytes(12),enc=crypto.createCipheriv('aes-256-gcm',this.inviteKey,iv);
    const body=Buffer.concat([enc.update(value,'utf8'),enc.final()]);
    return [iv,enc.getAuthTag(),body].map(b=>b.toString('base64url')).join('.');
  }
  _decryptCode(cipher){
    if(!this.inviteKey||!cipher)return null;
    try{const [iv,tag,body]=cipher.split('.').map(x=>Buffer.from(x,'base64url'));
      const dec=crypto.createDecipheriv('aes-256-gcm',this.inviteKey,iv);
      dec.setAuthTag(tag);return Buffer.concat([dec.update(body),dec.final()]).toString('utf8');
    }catch{return null;}
  }
  _inviteId(entry){return 'tinv_'+entry.hash.slice(0,24);}
  _findInboxEntry({memberAccountId,inviteId}){
    const member=checkId(memberAccountId),ref=String(inviteId||'');
    if(!/^tinv_[a-f0-9]{24}$/.test(ref))throw new ProTeamError('team_notification_not_found',404);
    const entry=[...this.invites.values()].find(row=>this._inviteId(row)===ref&&row.expiresAt>this.now()&&
      (row.memberEmail?normalizeEmail(this.emailFor(member))===row.memberEmail:row.memberAccountId===member));
    if(!entry||!this.accountActive(member))throw new ProTeamError('team_notification_not_found',404);
    this._eligible(entry.ownerAccountId);
    return entry;
  }
  inbox({memberAccountId}){
    const member=checkId(memberAccountId),email=normalizeEmail(this.emailFor(member));
    if(!email||!this.accountActive(member))return {notifications:[],unreadCount:0};
    const notifications=[];
    for(const entry of this.invites.values()){
      if(entry.expiresAt<=this.now()||(entry.memberEmail!==email&&entry.memberAccountId!==member))continue;
      try{this._eligible(entry.ownerAccountId);}catch{continue;}
      if(entry.ownerAccountId===member)continue;
      const read=this.notificationReads.get(member+':'+entry.hash);
      notifications.push({notificationId:this._inviteId(entry),type:'team_invitation',ownerAccountId:entry.ownerAccountId,ownerEmail:this.emailFor(entry.ownerAccountId)||null,
        expiresAt:entry.expiresAt,createdAt:entry.expiresAt-(entry.memberEmail?EMAIL_INVITE_TTL_MS:INVITE_TTL_MS),
        inviteCode:this._decryptCode(entry.cipher),readAt:read?.readAt||null});
    }
    notifications.sort((a,b)=>b.createdAt-a.createdAt);
    return {notifications:notifications.slice(0,50),unreadCount:notifications.filter(x=>!x.readAt).length};
  }
  readInbox({memberAccountId,notificationId}){
    const entry=this._findInboxEntry({memberAccountId,inviteId:notificationId}),member=checkId(memberAccountId);
    this.notificationReads.set(member+':'+entry.hash,{accountId:member,hash:entry.hash,readAt:this.now()});
    this._save();return {ok:true};
  }
  acceptInbox({memberAccountId,notificationId}){
    const entry=this._findInboxEntry({memberAccountId,inviteId:notificationId});
    return this._acceptEntry(checkId(memberAccountId),entry);
  }
  _acceptEntry(member,entry){
    const team=this._team(entry.ownerAccountId);
    if(!this.accountActive(member))throw new ProTeamError('team_member_not_active');
    if(!team.members.includes(member)){
      if(team.members.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);
      team.members.push(member);
    }
    this.invites.delete(entry.hash);
    this.notificationReads.delete(member+':'+entry.hash);
    this._save();return this.view(entry.ownerAccountId);
  }
  _team(owner){const team=this.teams.get(checkId(owner));if(!team)throw new ProTeamError('team_not_found',404);this._eligible(owner);return team;}
  create({ownerAccountId}={}){const owner=checkId(ownerAccountId);this._eligible(owner);if(this.teams.has(owner))return this.view(owner);this.teams.set(owner,{ownerAccountId:owner,members:[owner],devices:[],createdAt:this.now()});this._save();return this.view(owner);}
  view(owner){
    const t=this._team(owner);
    const memberEmails=Object.fromEntries(t.members.map(id=>[id,this.emailFor(id)||null]));
    return {ownerAccountId:t.ownerAccountId,ownerEmail:memberEmails[t.ownerAccountId],
      seatLimit:MAX_SEATS,usedSeats:t.members.length,members:[...t.members],memberEmails,devices:[...t.devices]};
  }
  invite({ownerAccountId,memberAccountId}={}){const owner=checkId(ownerAccountId),member=checkId(memberAccountId),team=this._team(owner);if(member===owner||team.members.includes(member))throw new ProTeamError('team_member_already_joined',409);if(!this.accountActive(member))throw new ProTeamError('team_member_not_active');if(team.members.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);
    // Pending invites reserve remaining seats. Prune expired tokens and prevent invite flooding.
    for(const [hash,row] of this.invites)if(row.expiresAt<=this.now()||row.ownerAccountId===owner&&row.memberAccountId===member)this.invites.delete(hash);
    const pending=[...this.invites.values()].filter(row=>row.ownerAccountId===owner);
    if(team.members.length+pending.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);
    const code=crypto.randomBytes(24).toString('base64url');const entry={hash:digest(code),ownerAccountId:owner,memberAccountId:member,expiresAt:this.now()+INVITE_TTL_MS};this.invites.set(entry.hash,entry);this._save();return {inviteCode:code,expiresAt:entry.expiresAt};}
  // Email invitations do not reveal account existence and also support
  // members who must sign up and verify the invited email before acceptance.
  inviteEmail({ownerAccountId,memberEmail}={}){
    const owner=checkId(ownerAccountId),email=normalizeEmail(memberEmail),team=this._team(owner);
    if(!EMAIL_RE.test(email)||email.length>254)throw new ProTeamError('invalid_team_invite_email',400);
    if(team.members.some(id=>normalizeEmail(this.emailFor(id))===email))throw new ProTeamError('team_member_already_joined',409);
    const now=this.now();
    this.emailInviteEvents=this.emailInviteEvents.filter(x=>x.issuedAt>now-24*60*60*1000);
    const recent=this.emailInviteEvents.filter(x=>x.ownerAccountId===owner);
    if(recent.length>=EMAIL_INVITE_DAILY_LIMIT)throw new ProTeamError('team_invite_rate_limited',429);
    if(recent.some(x=>x.memberEmail===email&&x.issuedAt>now-60_000))throw new ProTeamError('team_invite_cooldown',429);
    for(const [hash,row] of this.invites)
      if(row.expiresAt<=now||(row.ownerAccountId===owner&&row.memberEmail===email))this.invites.delete(hash);
    const pending=[...this.invites.values()].filter(x=>x.ownerAccountId===owner);
    if(team.members.length+pending.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);
    const code=crypto.randomBytes(24).toString('base64url');
    this.invites.set(digest(code),{hash:digest(code),ownerAccountId:owner,memberEmail:email,cipher:this._encryptCode(code),expiresAt:now+EMAIL_INVITE_TTL_MS});
    this.emailInviteEvents.push({ownerAccountId:owner,memberEmail:email,issuedAt:now});
    this._save();
    return {inviteCode:code,expiresAt:now+EMAIL_INVITE_TTL_MS};
  }
  accept({memberAccountId,inviteCode}={}){const member=checkId(memberAccountId),key=digest(String(inviteCode||'')),entry=this.invites.get(key);
    if(!entry||entry.expiresAt<=this.now())throw new ProTeamError('team_invite_invalid',403);
    if(entry.memberEmail
      ?normalizeEmail(this.emailFor(member))!==entry.memberEmail
      :entry.memberAccountId!==member)throw new ProTeamError('team_invite_invalid',403);
    return this._acceptEntry(member,entry);}
  shareDevice({ownerAccountId,deviceId,deviceOwnerAccountId}={}){const team=this._team(ownerAccountId);if(deviceOwnerAccountId!==team.ownerAccountId)throw new ProTeamError('team_cannot_share_foreign_device');const device=checkId(deviceId);if(!team.devices.includes(device))team.devices.push(device);this._save();return this.view(team.ownerAccountId);}
  unshareDevice({ownerAccountId,deviceId}={}){
    const team=this._team(ownerAccountId),did=checkId(deviceId),
      wasShared=team.devices.includes(did);
    team.devices=team.devices.filter(x=>x!==did);
    this._save();
    if(wasShared)for(const memberAccountId of team.members){
      if(memberAccountId===team.ownerAccountId)continue;
      this.onRevoke({ownerAccountId:team.ownerAccountId,memberAccountId,
        deviceId:did,reason:'team_device_unshared'});
    }
    return this.view(team.ownerAccountId);
  }
  remove({ownerAccountId,memberAccountId}={}){
    const team=this._team(ownerAccountId),member=checkId(memberAccountId);
    if(member===team.ownerAccountId)throw new ProTeamError('team_owner_cannot_remove_self');
    const wasMember=team.members.includes(member);
    team.members=team.members.filter(x=>x!==member);
    this._save();
    if(wasMember)for(const deviceId of team.devices)
      this.onRevoke({ownerAccountId:team.ownerAccountId,memberAccountId:member,
        deviceId,reason:'team_member_removed'});
    return this.view(team.ownerAccountId);
  }
  memberships(memberAccountId){
    const member=checkId(memberAccountId),results=[];
    for(const team of this.teams.values()){
      if(!team.members.includes(member)||member===team.ownerAccountId)continue;
      try{this._eligible(team.ownerAccountId);}catch{continue;}
      if(!this.accountActive(member))continue;
      results.push({ownerAccountId:team.ownerAccountId,ownerEmail:this.emailFor(team.ownerAccountId)||null,seatLimit:MAX_SEATS,usedSeats:team.members.length,
        sharedDevices:[...team.devices],crossAccountExecutionEnabled:false});
    }
    return results.sort((a,b)=>a.ownerAccountId.localeCompare(b.ownerAccountId));
  }
  authorize({deviceOwnerAccountId,actorAccountId,deviceId}={}){const owner=checkId(deviceOwnerAccountId),actor=checkId(actorAccountId);if(owner===actor)return true;const team=this.teams.get(owner);if(!team)return false;try{this._eligible(owner)}catch{return false;}return team.members.includes(actor)&&team.devices.includes(String(deviceId))&&this.accountActive(actor);}
}
export const PRO_TEAM_MAX_SEATS=MAX_SEATS;
