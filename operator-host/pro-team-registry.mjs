import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_SEATS=5;
const INVITE_TTL_MS=15*60*1000;
const valid=value=>/^[A-Za-z0-9._:-]{1,128}$/.test(String(value||''));
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
export class ProTeamError extends Error{constructor(message,status=403){super(message);this.status=status;}}
function checkId(id){if(!valid(id))throw new ProTeamError('invalid_team_account',400);return String(id);}
export class ProTeamRegistry {
  constructor({stateFile=null,now=()=>Date.now(),planFor=()=> 'free',accountActive=()=>true}={}){
    this.stateFile=stateFile;this.now=now;this.planFor=planFor;this.accountActive=accountActive;
    this.teams=new Map();this.invites=new Map();
    if(stateFile&&fs.existsSync(stateFile)){
      const parsed=JSON.parse(fs.readFileSync(stateFile,'utf8'));
      if(parsed.schemaVersion!==1)throw new ProTeamError('invalid_team_state',500);
      for(const team of parsed.teams||[])this.teams.set(team.ownerAccountId,team);
      for(const invite of parsed.invites||[])this.invites.set(invite.hash,invite);
    }
  }
  _save(){if(!this.stateFile)return;fs.mkdirSync(path.dirname(this.stateFile),{recursive:true,mode:0o750});const tmp=this.stateFile+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({schemaVersion:1,teams:[...this.teams.values()],invites:[...this.invites.values()]},null,2)+'\n',{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,this.stateFile);}
  _eligible(owner){const plan=String(this.planFor(owner)||'free').toLowerCase();if(!['pro','vip'].includes(plan)||!this.accountActive(owner))throw new ProTeamError('pro_team_subscription_required');}
  _team(owner){const team=this.teams.get(checkId(owner));if(!team)throw new ProTeamError('team_not_found',404);this._eligible(owner);return team;}
  create({ownerAccountId}={}){const owner=checkId(ownerAccountId);this._eligible(owner);if(this.teams.has(owner))return this.view(owner);this.teams.set(owner,{ownerAccountId:owner,members:[owner],devices:[],createdAt:this.now()});this._save();return this.view(owner);}
  view(owner){const t=this._team(owner);return {ownerAccountId:t.ownerAccountId,seatLimit:MAX_SEATS,usedSeats:t.members.length,members:[...t.members],devices:[...t.devices]};}
  invite({ownerAccountId,memberAccountId}={}){const owner=checkId(ownerAccountId),member=checkId(memberAccountId),team=this._team(owner);if(member===owner||team.members.includes(member))throw new ProTeamError('team_member_already_joined',409);if(!this.accountActive(member))throw new ProTeamError('team_member_not_active');if(team.members.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);
    const code=crypto.randomBytes(24).toString('base64url');const entry={hash:digest(code),ownerAccountId:owner,memberAccountId:member,expiresAt:this.now()+INVITE_TTL_MS};this.invites.set(entry.hash,entry);this._save();return {inviteCode:code,expiresAt:entry.expiresAt};}
  accept({memberAccountId,inviteCode}={}){const member=checkId(memberAccountId),key=digest(String(inviteCode||'')),entry=this.invites.get(key);if(!entry||entry.expiresAt<=this.now()||entry.memberAccountId!==member)throw new ProTeamError('team_invite_invalid',403);const team=this._team(entry.ownerAccountId);if(!this.accountActive(member))throw new ProTeamError('team_member_not_active');if(!team.members.includes(member)){if(team.members.length>=MAX_SEATS)throw new ProTeamError('team_seat_limit',429);team.members.push(member);}this.invites.delete(key);this._save();return this.view(entry.ownerAccountId);}
  shareDevice({ownerAccountId,deviceId,deviceOwnerAccountId}={}){const team=this._team(ownerAccountId);if(deviceOwnerAccountId!==team.ownerAccountId)throw new ProTeamError('team_cannot_share_foreign_device');const device=checkId(deviceId);if(!team.devices.includes(device))team.devices.push(device);this._save();return this.view(team.ownerAccountId);}
  unshareDevice({ownerAccountId,deviceId}={}){const team=this._team(ownerAccountId);team.devices=team.devices.filter(x=>x!==String(deviceId));this._save();return this.view(team.ownerAccountId);}
  remove({ownerAccountId,memberAccountId}={}){const team=this._team(ownerAccountId),member=checkId(memberAccountId);if(member===team.ownerAccountId)throw new ProTeamError('team_owner_cannot_remove_self');team.members=team.members.filter(x=>x!==member);this._save();return this.view(team.ownerAccountId);}
  authorize({deviceOwnerAccountId,actorAccountId,deviceId}={}){const owner=checkId(deviceOwnerAccountId),actor=checkId(actorAccountId);if(owner===actor)return true;const team=this.teams.get(owner);if(!team)return false;try{this._eligible(owner)}catch{return false;}return team.members.includes(actor)&&team.devices.includes(String(deviceId))&&this.accountActive(actor);}
}
export const PRO_TEAM_MAX_SEATS=MAX_SEATS;
