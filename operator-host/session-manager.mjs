import crypto from 'node:crypto';

export const SESSION_GRACE_PRESETS = Object.freeze({
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '45m': 45 * 60 * 1000,
  '60m': 60 * 60 * 1000,
  '1h': 60 * 60 * 1000
});

export class SessionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export class SessionRegistry {
  constructor({ idleMs = 30 * 60 * 1000, minIdleMs = 15 * 60 * 1000, maxIdleMs = 60 * 60 * 1000,
    activeWindowMs = 60 * 1000, maxActive = 5, historyMs = 7 * 24 * 60 * 60 * 1000,
    accountId = 'self-hosted-local', deviceId = 'arm-local', nodeId = 'arm', emit = () => {}, now = () => Date.now() } = {}) {
    this.idleMs = Number(idleMs);
    this.minIdleMs = Number(minIdleMs);
    this.maxIdleMs = Number(maxIdleMs);
    this.activeWindowMs = Number(activeWindowMs);
    this.maxActive = Number(maxActive);
    if (![this.minIdleMs,this.maxIdleMs,this.idleMs,this.activeWindowMs].every(Number.isFinite) || this.minIdleMs < 100 || this.maxIdleMs < this.minIdleMs || this.idleMs < this.minIdleMs || this.idleMs > this.maxIdleMs || this.activeWindowMs < 0 || this.activeWindowMs > this.maxIdleMs) throw new SessionError('invalid_session_grace_config');
    if (!Number.isInteger(this.maxActive) || this.maxActive < 1 || this.maxActive > 1000) throw new SessionError('invalid_session_capacity_config');    this.historyMs = Number(historyMs);
    this.accountId = String(accountId || 'self-hosted-local');
    this.deviceId = String(deviceId || 'arm-local');
    this.nodeId = String(nodeId || 'arm');
    this.emit = emit;
    this.now = now;
    this.sessions = new Map();
    this.openDedupe = new Map();
    this.agentDeviceSessions = new Map();
  }

  _id() { return `s_${this.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`; }
  _validId(id) { return /^[A-Za-z0-9._:-]{1,128}$/.test(String(id || '')); }
  _validAgent(id) { return /^[A-Za-z0-9._:-]{16,128}$/.test(String(id || '')); }
  _laneKey(deviceId, agentId) { return `${String(deviceId)}\u0000${String(agentId)}`; }
  _openKey(deviceId, openId) { return `${String(deviceId)}\u0000${String(openId)}`; }

  _grace(value) {
    if (value == null || value === '') return this.idleMs;
    const grace = Number(value);
    if (!Number.isFinite(grace) || grace < this.minIdleMs || grace > this.maxIdleMs) throw new SessionError('invalid_session_grace');
    return Math.round(grace);
  }

  _graceSpec(value, preset) {
    const name = String(preset || '').trim().toLowerCase();    if (!name) return { graceMs:this._grace(value), gracePreset:(value == null || value === '') ? 'default' : 'custom' };
    if (['always','always-keep-alive','always_keep_alive','unlimited'].includes(name)) throw new SessionError('session_grace_unlimited_not_available');
    if (name === 'custom') {
      if (value == null || value === '') throw new SessionError('custom_session_grace_required');
      return { graceMs:this._grace(value), gracePreset:'custom' };
    }
    if (!(name in SESSION_GRACE_PRESETS)) throw new SessionError('invalid_session_grace_preset');
    if (value != null && value !== '') throw new SessionError('session_grace_preset_conflict');
    return { graceMs:this._grace(SESSION_GRACE_PRESETS[name]), gracePreset:name === '1h' ? '60m' : name };
  }

  _unlinkLane(s) {
    const key=this._laneKey(s.deviceId,s.agentId);
    if (this.agentDeviceSessions.get(key) === s.id) this.agentDeviceSessions.delete(key);
  }

  _state(s, now = this.now()) {
    if (s.closedAt) return 'closed';
    if (s.expiredAt) return 'expired';
    if (s.activeJobs.size) return 'hold';
    if (now - s.lastSeenAt >= s.graceMs) {
      s.expiredAt = now;
      this._unlinkLane(s);
      this.emit({ type:'session_expired', accountId:s.accountId, deviceId:s.deviceId, sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, status:'expired', graceMs:s.graceMs, gracePreset:s.gracePreset });
      return 'expired';
    }
    if (s.holdReason || now - s.lastSeenAt >= this.activeWindowMs) return 'hold';
    return 'active';
  }

  _view(s, now = this.now()) {
    const state=this._state(s,now);
    const activeJobHold=state==='hold' && s.activeJobs.size>0;
    const inferredHold=state==='hold' && !activeJobHold;
    const holdReason=activeJobHold ? 'active_job' : inferredHold ? (s.holdReason || 'agent_inactive') : null;    return {
      accountId:s.accountId, deviceId:s.deviceId, sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId,
      openId:s.openId || null, label:s.label, workspace:s.workspace, implicit:s.implicit, state,
      graceMs:s.graceMs, gracePreset:s.gracePreset,
      // Compatibility aliases for v0.9 callers while the protocol migrates from lease terminology.
      leaseMs:s.graceMs, leasePreset:s.gracePreset,
      createdAt:s.createdAt, lastSeenAt:s.lastSeenAt, closedAt:s.closedAt, expiredAt:s.expiredAt,
      expiresAt: (state==='active'||state==='hold') && !activeJobHold ? s.lastSeenAt+s.graceMs : null,
      holdReason, activeJobs:[...s.activeJobs], connectCount:s.connectCount, reconnectCount:s.reconnectCount,
      stats:{...s.stats}
    };
  }

  _owner(s, agentId) {
    const aid=String(agentId||'').trim();
    if (!this._validAgent(aid)) throw new SessionError('invalid_agent_id');
    if (s.agentId!==aid) throw new SessionError('session_owner_mismatch',409);
    return aid;
  }

  prune(now=this.now()) {
    for (const [id,s] of this.sessions) {
      const state=this._state(s,now), terminalAt=s.closedAt||s.expiredAt;
      if ((state==='closed'||state==='expired') && terminalAt && now-terminalAt>this.historyMs) {
        this.sessions.delete(id);
        if (s.openId) this.openDedupe.delete(this._openKey(s.deviceId,s.openId));
        this._unlinkLane(s);
      }
    }
  }

  activeCount(now=this.now()) {
    this.prune(now);
    let n=0; for (const s of this.sessions.values()) if (['active','hold'].includes(this._state(s,now))) n++;
    return n;
  }

  activeCountByNode(nodeId,now=this.now()) {
    this.prune(now); const nid=String(nodeId||'');
    let n=0; for (const s of this.sessions.values()) if (s.nodeId===nid&&['active','hold'].includes(this._state(s,now))) n++;
    return n;
  }
  activeCountByDevice(deviceId,now=this.now()) {
    this.prune(now); const did=String(deviceId||'');
    let n=0; for (const s of this.sessions.values()) if (s.deviceId===did&&['active','hold'].includes(this._state(s,now))) n++;
    return n;
  }

  open({ id=null, openId=null, agentId, label='', workspace='', implicit=false,
    graceMs=null, gracePreset=null, leaseMs=null, leasePreset=null, nodeId=null, deviceId=null, maxActiveForNode=null }={}) {
    this.prune();
    const aid=String(agentId||'').trim();
    if (!this._validAgent(aid)) throw new SessionError('invalid_agent_id');
    const targetNodeId=String(nodeId||this.nodeId).trim(), targetDeviceId=String(deviceId||this.deviceId).trim();
    if (!this._validId(targetNodeId)) throw new SessionError('invalid_node_id');
    if (!this._validId(targetDeviceId)) throw new SessionError('invalid_device_id');
    let nodeCeiling=null;
    if (maxActiveForNode!=null) {
      nodeCeiling=Number(maxActiveForNode);
      if (!Number.isInteger(nodeCeiling)||nodeCeiling<1||nodeCeiling>1000) throw new SessionError('invalid_node_session_capacity');
    }
    const laneKey=this._laneKey(targetDeviceId,aid), liveId=this.agentDeviceSessions.get(laneKey), live=liveId?this.sessions.get(liveId):null;
    if (live&&['active','hold'].includes(this._state(live))) {
      if (live.nodeId!==targetNodeId) throw new SessionError('agent_session_target_conflict',409);
      this.emit({type:'session_reused_for_agent',accountId:live.accountId,deviceId:live.deviceId,sessionId:live.id,agentId:aid,nodeId:live.nodeId,status:this._state(live)});
      return this._view(live);
    }
    if (liveId) this.agentDeviceSessions.delete(laneKey);
    const stableOpenId=openId==null||openId===''?null:String(openId);
    if (stableOpenId&&!/^[A-Za-z0-9._:-]{16,128}$/.test(stableOpenId)) throw new SessionError('invalid_session_open_id');
    if (stableOpenId) {
      const openKey=this._openKey(targetDeviceId,stableOpenId), priorId=this.openDedupe.get(openKey), prior=priorId?this.sessions.get(priorId):null;
      if (prior) {
        this._owner(prior,aid);
        const state=this._state(prior);
        if (state==='expired'||state==='closed') throw new SessionError('session_open_id_expired',410);
        return this._view(prior);
      }
      if (priorId) this.openDedupe.delete(openKey);
    }
    if (this.activeCount()>=this.maxActive) throw new SessionError('session_capacity_reached',429);
    if (nodeCeiling!=null&&this.activeCountByNode(targetNodeId)>=nodeCeiling) throw new SessionError('node_session_capacity_reached',429);
    const sessionId=id?String(id):this._id();
    if (!this._validId(sessionId)) throw new SessionError('invalid_session_id');
    if (this.sessions.has(sessionId)) throw new SessionError('session_already_exists',409);
    const requestedGrace=graceMs??leaseMs, requestedPreset=gracePreset??leasePreset;
    const graceSpec=this._graceSpec(requestedGrace,requestedPreset), now=this.now();
    const s={id:sessionId,accountId:this.accountId,deviceId:targetDeviceId,agentId:aid,nodeId:targetNodeId,openId:stableOpenId,
      label:String(label||'').slice(0,120),workspace:String(workspace||'').slice(0,512),implicit:Boolean(implicit),
      graceMs:graceSpec.graceMs,gracePreset:graceSpec.gracePreset,createdAt:now,lastSeenAt:now,closedAt:null,expiredAt:null,
      holdReason:null,activeJobs:new Set(),connectCount:1,reconnectCount:0,
      stats:{toolCalls:0,execCalls:0,jobsStarted:0,jobsFinished:0,outputReads:0,jobReads:0,errors:0}};
    this.sessions.set(sessionId,s); this.agentDeviceSessions.set(laneKey,sessionId);
    if (stableOpenId) this.openDedupe.set(this._openKey(targetDeviceId,stableOpenId),sessionId);    this.emit({type:'session_opened',accountId:s.accountId,deviceId:s.deviceId,sessionId,agentId:aid,nodeId:s.nodeId,openId:stableOpenId,status:'active',label:s.label,workspace:s.workspace,implicit:s.implicit,graceMs:s.graceMs,gracePreset:s.gracePreset});
    return this._view(s,now);
  }

  ensure(id,{agentId,implicit=false}={}) {
    const sessionId=String(id||'').trim();
    if (!this._validId(sessionId)) throw new SessionError('invalid_session_id');
    let s=this.sessions.get(sessionId);
    if (!s) {
      if (!implicit) throw new SessionError('session_not_found',404);
      this.open({id:sessionId,agentId,label:'legacy/implicit',implicit:true}); s=this.sessions.get(sessionId);
    }
    this._owner(s,agentId);
    const state=this._state(s);
    if (state==='expired') throw new SessionError('session_expired',410);
    if (state==='closed') throw new SessionError('session_closed',410);
    s.lastSeenAt=this.now(); s.holdReason=null;
    return s;
  }

  resume(id,agentId) {
    const s=this.sessions.get(String(id||'')); if (!s) throw new SessionError('session_not_found',404);
    this._owner(s,agentId); const state=this._state(s);
    if (state==='expired') throw new SessionError('session_expired',410);
    if (state==='closed') throw new SessionError('session_closed',410);
    s.lastSeenAt=this.now(); s.holdReason=null; s.connectCount++; s.reconnectCount++;
    this.emit({type:'session_resumed',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,status:this._state(s),reconnectCount:s.reconnectCount});
    return this._view(s);
  }
  hold(id,agentId,reason='transport_lost') {
    const s=this.sessions.get(String(id||'')); if (!s) throw new SessionError('session_not_found',404);
    this._owner(s,agentId); const state=this._state(s);
    if (state==='expired') throw new SessionError('session_expired',410);
    if (state==='closed') throw new SessionError('session_closed',410);
    s.holdReason=String(reason||'transport_lost').slice(0,80);
    this.emit({type:'session_hold_started',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,status:'hold',reason:s.holdReason});
    return this._view(s);
  }

  get(id,agentId=null) {
    const s=this.sessions.get(String(id||'')); if (!s) throw new SessionError('session_not_found',404);
    if (agentId!=null) this._owner(s,agentId);
    return this._view(s);
  }

  list({deviceId=null}={}) {
    this.prune(); const did=deviceId==null?null:String(deviceId);
    return [...this.sessions.values()].filter(s=>did==null||s.deviceId===did).map(s=>this._view(s)).sort((a,b)=>b.createdAt-a.createdAt);
  }

  close(id,agentId,reason='owner_or_agent_closed') {
    const s=this.sessions.get(String(id||'')); if (!s) throw new SessionError('session_not_found',404);
    this._owner(s,agentId);
    if (s.activeJobs.size) throw new SessionError('session_busy',409);
    if (!s.closedAt) {
      s.closedAt=this.now(); s.holdReason=null; this._unlinkLane(s);
      this.emit({type:'session_closed',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,status:'closed',reason});
    }
    return this._view(s);
  }
  closeByDevice(deviceId,reason='device_connection_closed',{force=true}={}) {
    const did=String(deviceId||''); const closed=[];
    for (const s of this.sessions.values()) {
      if (s.deviceId!==did||!['active','hold'].includes(this._state(s))) continue;
      if (s.activeJobs.size&&!force) continue;
      s.closedAt=this.now(); s.holdReason=null; this._unlinkLane(s); closed.push(s.id);
      this.emit({type:'session_closed',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,status:'closed',reason,forced:Boolean(s.activeJobs.size)});
    }
    return closed;
  }

  touch(id,agentId,action='tool') {
    const s=this.ensure(id,{agentId}); s.stats.toolCalls++; s.lastSeenAt=this.now(); s.holdReason=null;
    this.emit({type:'session_activity',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,action:'toolCalls',tool:String(action||'tool').slice(0,120),status:this._state(s)});
    return this._view(s);
  }

  record(id,field) {
    const s=this.sessions.get(String(id||'')); if (!s) return;
    if (field in s.stats) s.stats[field]++;
    s.lastSeenAt=this.now(); s.holdReason=null;
    this.emit({type:'session_activity',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,action:field,status:this._state(s)});
  }

  attachJob(id,jobId) {
    const s=this.sessions.get(String(id||'')); if (!s) throw new SessionError('session_not_found',404);
    const wasHolding=s.activeJobs.size>0; s.activeJobs.add(jobId); s.stats.jobsStarted++; s.lastSeenAt=this.now(); s.holdReason=null;
    if (!wasHolding) this.emit({type:'session_hold_started',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,jobId,status:'hold',reason:'active_job'});
  }

  finishJob(id,jobId,jobStatus) {
    const s=this.sessions.get(String(id||'')); if (!s) return;
    s.activeJobs.delete(jobId); s.stats.jobsFinished++; s.lastSeenAt=this.now(); s.holdReason=null;
    if (!s.activeJobs.size) this.emit({type:'session_hold_released',accountId:s.accountId,deviceId:s.deviceId,sessionId:s.id,agentId:s.agentId,nodeId:s.nodeId,jobId,status:'active',jobStatus,graceMs:s.graceMs,gracePreset:s.gracePreset});
  }
}
