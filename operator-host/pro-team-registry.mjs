import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_SEATS=5;
const INVITE_TTL_MS=15*60*1000;
const EMAIL_INVITE_TTL_MS=24*60*60*1000;
const EMAIL_INVITE_DAILY_LIMIT=12;
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail=value=>String(value||'').trim().toLowerCase();
const valid=value=>/^[A-Za-z0-9._:-]{1,128}$/.test(String(value||''));
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
export class ProTeamError extends Error{constructor(message,status=403){super(message);this.status=status;}}
function checkId(id){if(!valid(id))throw new ProTeamError('invalid_team_account',400);return String(id);}
export class ProTeamRegistry {
  constructor({stateFile=null,now=()=>Date.now(),planFor=()=> 'free',accountActive=()=>true,emailFor=()=>null,onRevoke=()=>{}}={}){
    this.stateFile=stateFile;this.now=now;this.planFor=planFor;this.accountActive=accountActive;this.emailFor=emailFor;this.onRevoke=onRevoke;
    this.teams=new Map();this.invites=new Map();this.emailInviteEvents=[];
    if(stateFile&&fs.existsSync(stateFile)){
      const parsed=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(parsed.schemaVersion!==1)throw new ProTeamError('invalid_team_state',500);
      for(const team of parsed.teams||[])this.teams.set(team.ownerAccountId,team);
      for(const invite of parsed.invites||[])this.invites.set(invite.hash,invite);
      this.emailInviteEvents=Array.isArray(parsed.emailInviteEvents)?parsed.emailInviteEvents.filter(x=>Number.isFinite(x.issuedAt)):[];
    }
  }
  _save(){if(!this.stateFile)return;fs.mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o750});const tmp=this.stateFile+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,teams:[...this.teams.values()],invites:[...this.invites.values()],emailInviteEvents:this.emailInviteEvents},null,2)+'\n',{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);}
  _eligible(owner){const plan=String(this.planFor(owner)||'free').toLowerCase();if(!['pro','vip'].includes(plan)||!this.accountActive(owner))throw new ProTeamError('pro_team_subscription_required');}
  _team(owner){const team=this.teams.get(checkId(owner));if(!team)throw new ProTeamError('team_not_found',404);this._eligible(owner);return team;}
  create({ownerAccountId}={}){const owner=checkId(ownerAccountId);this._eligible(owner);if(this.teams.has(owner))return this.view(owner);this.teams.set(owner,{ownerAccountId:owner,members:[owner],devices:[],createdAt:this.now()});this._save();return this.view(owner);}
  view(owner){const t=this._team(owner);return {ownerAccountId:t.ownerAccountId,seatLimit:MAX_SEATS,usedSeats:t.members.length,members:[...t.members],devices:[...t.devices]};}
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
    this.invites.set(digest(code),{hash:digest(code),ownerAccountId:owner,memberEmail:email,expiresAt:now+EMAIL_INVITE_TTL_MS});
    this.emailInviteEvents.push({ownerAccountId:owner,memberEmail:email,issuedAt:now});
    this._save();
    return {inviteCode:code,expiresAt:now+EMAIL_INVITE_TTL_MS};
  }
  accept({memberAccountId,inviteCode}={}){const member=checkId(memberAccountId),key=digest(String(inviteCode||'')),entry=this.invites.get(key);
    if(!entry||entry.expiresAt<=this.now())throw new ProTeamError('team_invite_invalid',403);
    if(entry.memberEmail
      ?normalizeEmail(this.emailFor(member))!==entry.memberEmail
      :entry.memberAccountId!==member)throw new ProTeamError('team_invite_invalid',403);
    const team=this._team(entry.ownerAccountId);if(!this.accountActive(member))throw new ProTeamError('team_member_not_active');if(!team.members.includes(member)){if(team.members.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);team.members.push(member);}this.invites.delete(key);this._save();return this.view(entry.ownerAccountId);}
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
      results.push({ownerAccountId:team.ownerAccountId,seatLimit:MAX_SEATS,usedSeats:team.members.length,
        sharedDevices:[...team.devices],crossAccountExecutionEnabled:false});
    }
    return results.sort((a,b)=>a.ownerAccountId.localeCompare(b.ownerAccountId));
  }
  authorize({deviceOwnerAccountId,actorAccountId,deviceId}={}){const owner=checkId(deviceOwnerAccountId),actor=checkId(actorAccountId);if(owner===actor)return true;const team=this.teams.get(owner);if(!team)return false;try{this._eligible(owner)}catch{return false;}return team.members.includes(actor)&&team.devices.includes(String(deviceId))&&this.accountActive(actor);}
}
export const PRO_TEAM_MAX_SEATS=MAX_SEATS;
