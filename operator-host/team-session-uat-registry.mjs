import {SessionRegistry,SessionError} from './session-manager.mjs';
import {assertTeamBoundSession,TeamDispatchAuthorityError} from './team-dispatch-authority.mjs';

/**
 * Pure UAT-only, separate in-memory session plane. Never shares its registry
 * with production SessionRegistry or command dispatch; no jobs can run here.
 * resolveAuthority must reload source-of-truth device, connection, member,
 * owner entitlement, client-bound grant and capabilities on EACH operation.
 */
export class TeamSessionUatRegistry{
  constructor({resolveAuthority,now=()=>Date.now(),maxActive=64,maxPerNode=5,emit=()=>{}}={}){
    if(typeof resolveAuthority!=='function'||typeof now!=='function')
      throw new TeamDispatchAuthorityError('team_session_authority_required',503);
    this.resolveAuthority=resolveAuthority;
    this.now=now;
    this.maxPerNode=maxPerNode;
    this.bindings=new Map();
    this.sessions=new SessionRegistry({now,maxActive,emit,beforeRecord:()=>({})});
  }

  _authority({authenticatedActorAccountId,authenticatedAgentId,deviceId,operation,requiredCapabilities}){
    if(!Array.isArray(requiredCapabilities)||!requiredCapabilities.length)
      throw new TeamDispatchAuthorityError('team_session_capabilities_required',400);
    const authority=this.resolveAuthority({
      authenticatedActorAccountId,authenticatedAgentId,deviceId,operation,
      requiredCapabilities
    });
    if(authority?.teamShared!==true||
       authority.actorAccountId!==authenticatedActorAccountId||
       authority.agentId!==authenticatedAgentId||
       authority.deviceId!==deviceId||
       !authority.deviceOwnerAccountId||
       authority.deviceOwnerAccountId!==authority.billedAccountId||
       !authority.accessGrantId||
       !Number.isFinite(Number(authority.accessExpiresAt))||
       Number(authority.accessExpiresAt)<=this.now())
      throw new TeamDispatchAuthorityError('team_session_trusted_authority_required',403);
    return authority;
  }

  _view(base,binding){
    return Object.freeze({
      sessionId:base.sessionId,
      accountId:base.accountId,
      actorAccountId:binding.actorAccountId,
      deviceOwnerAccountId:binding.deviceOwnerAccountId,
      billedAccountId:binding.billedAccountId,
      deviceId:base.deviceId,
      nodeId:base.nodeId,
      state:base.state,
      operation:binding.operation,
      requiredCapabilities:Object.freeze([...binding.requiredCapabilities]),
      workspace:base.workspace,
      gracePreset:base.gracePreset,
      createdAt:base.createdAt,
      lastSeenAt:base.lastSeenAt,
      expiresAt:base.expiresAt==null?null:Math.min(base.expiresAt,binding.accessExpiresAt),
      accessExpiresAt:binding.accessExpiresAt,
      holdReason:base.holdReason,
      reconnectCount:base.reconnectCount,
      activeJobs:Object.freeze([]),
      previewOnly:true,
      crossAccountExecutionEnabled:false
    });
  }

  _retire(sessionId,reason='team_authority_changed'){
    const binding=this.bindings.get(sessionId);
    if(!binding)return;
    try{this.sessions.close(sessionId,binding.agentId,reason);}catch(error){
      // UAT never dispatches a job; if a future regression gives it one, fail
      // closed instead of silently reusing its authorization.
      if(error?.message==='session_busy')
        this.sessions.closeByDevice(binding.deviceId,'team_uat_unexpected_job',{force:true});
    }
    this.bindings.delete(sessionId);
  }

  _verifiedSession(sessionId,{authenticatedActorAccountId,authenticatedAgentId}={}){
    const binding=this.bindings.get(String(sessionId||''));
    if(!binding)throw new TeamDispatchAuthorityError('team_session_not_found',404);
    if(binding.actorAccountId!==authenticatedActorAccountId||
       binding.agentId!==authenticatedAgentId)
      throw new TeamDispatchAuthorityError('team_session_oauth_actor_mismatch',403);
    const base=this.sessions.get(sessionId,authenticatedAgentId);
    if(!['active','hold'].includes(base.state)){
      this.bindings.delete(sessionId);
      throw new TeamDispatchAuthorityError('team_session_not_active',410);
    }
    try{
      if(this.now()>=binding.accessExpiresAt)
        throw new TeamDispatchAuthorityError('team_session_ab_expired',410);
      const fresh=this._authority({
        authenticatedActorAccountId,authenticatedAgentId,
        deviceId:binding.deviceId,
        operation:binding.operation,
        requiredCapabilities:binding.requiredCapabilities
      });
      if(fresh.accessGrantId!==binding.accessGrantId||
         fresh.nodeId!==binding.nodeId||
         fresh.deviceOwnerAccountId!==binding.deviceOwnerAccountId||
         fresh.billedAccountId!==binding.billedAccountId)
        throw new TeamDispatchAuthorityError('team_session_authority_rotated',403);
      // Connection lease renewal must NEVER silently extend a session's
      // previously approved deadline.
      const bounded={...fresh,accessExpiresAt:binding.accessExpiresAt};
      assertTeamBoundSession({session:{
        ...base,
        deviceOwnerAccountId:binding.deviceOwnerAccountId,
        billedAccountId:binding.billedAccountId,
        accessGrantId:binding.accessGrantId,
        accessExpiresAt:binding.accessExpiresAt
      },authority:bounded});
      return {base,binding};
    }catch(error){
      this._retire(sessionId,'team_authority_invalid');
      throw error;
    }
  }

  open({authenticatedActorAccountId,authenticatedAgentId,deviceId,
    operation='exec',requiredCapabilities=[],workspace='',label='Pro Team UAT',
    gracePreset='60m',openId=null}={}){
    const authority=this._authority({
      authenticatedActorAccountId,authenticatedAgentId,deviceId,operation,
      requiredCapabilities
    });
    const lane=[...this.bindings.entries()].find(([,b])=>
      b.actorAccountId===authenticatedActorAccountId&&
      b.agentId===authenticatedAgentId&&b.deviceId===deviceId);
    if(lane){
      const [sessionId,binding]=lane;
      if(binding.operation!==operation||
         JSON.stringify(binding.requiredCapabilities)!==
           JSON.stringify([...new Set(requiredCapabilities)].sort()))
        throw new TeamDispatchAuthorityError('team_session_operation_conflict',409);
      const {base}=this._verifiedSession(sessionId,{
        authenticatedActorAccountId,authenticatedAgentId
      });
      // _verifiedSession revokes a session on changed owner/approval. Never
      // silently issue a new session after implicit revocation.
      return this._view(base,binding);
    }
    const base=this.sessions.open({
      accountId:authority.actorAccountId,
      agentId:authority.agentId,
      deviceId:authority.deviceId,
      nodeId:authority.nodeId,
      openId,label,workspace,gracePreset,
      maxActiveForNode:this.maxPerNode
    });
    const binding=Object.freeze({
      actorAccountId:authority.actorAccountId,
      deviceOwnerAccountId:authority.deviceOwnerAccountId,
      billedAccountId:authority.billedAccountId,
      agentId:authority.agentId,
      deviceId:authority.deviceId,
      nodeId:authority.nodeId,
      accessGrantId:authority.accessGrantId,
      accessExpiresAt:Number(authority.accessExpiresAt),
      operation:authority.operation,
      requiredCapabilities:Object.freeze([...authority.requiredCapabilities])
    });
    this.bindings.set(base.sessionId,binding);
    return this._view(base,binding);
  }

  get(sessionId,identity){
    const {base,binding}=this._verifiedSession(sessionId,identity);
    return this._view(base,binding);
  }
  resume(sessionId,identity){
    const {binding}=this._verifiedSession(sessionId,identity);
    return this._view(this.sessions.resume(sessionId,binding.agentId),binding);
  }
  hold(sessionId,identity,reason='agent_inactive'){
    const {binding}=this._verifiedSession(sessionId,identity);
    return this._view(this.sessions.hold(sessionId,binding.agentId,reason),binding);
  }
  touch(sessionId,identity,action='preview'){
    const {binding}=this._verifiedSession(sessionId,identity);
    return this._view(this.sessions.touch(sessionId,binding.agentId,action),binding);
  }
  close(sessionId,{authenticatedActorAccountId,authenticatedAgentId}={}){
    const binding=this.bindings.get(String(sessionId||''));
    if(!binding)throw new TeamDispatchAuthorityError('team_session_not_found',404);
    if(binding.actorAccountId!==authenticatedActorAccountId||
       binding.agentId!==authenticatedAgentId)
      throw new TeamDispatchAuthorityError('team_session_oauth_actor_mismatch',403);
    const base=this.sessions.close(sessionId,binding.agentId,'team_owner_or_member_closed');
    this.bindings.delete(sessionId);
    return this._view(base,binding);
  }
  list({authenticatedActorAccountId,authenticatedAgentId}={}){
    const rows=[];
    for(const [sessionId,b] of this.bindings){
      if(b.actorAccountId!==authenticatedActorAccountId||
         b.agentId!==authenticatedAgentId)continue;
      try{rows.push(this.get(sessionId,{authenticatedActorAccountId,authenticatedAgentId}));}
      catch(error){if(!['team_session_not_active','team_session_ab_expired',
        'team_session_authority_rotated'].includes(error?.message)&&
        error?.status!==403)throw error;}
    }
    return rows;
  }
}
