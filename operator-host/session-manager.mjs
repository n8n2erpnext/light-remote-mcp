import crypto from 'node:crypto';

export class SessionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export class SessionRegistry {
  constructor({ idleMs = 30 * 60 * 1000, maxActive = 5, historyMs = 7 * 24 * 60 * 60 * 1000, nodeId = 'arm', emit = () => {} } = {}) {
    this.idleMs = idleMs;
    this.maxActive = maxActive;
    this.historyMs = historyMs;
    this.nodeId = String(nodeId || 'arm');
    this.emit = emit;
    this.sessions = new Map();
    this.openDedupe = new Map();
    this.agentSessions = new Map();
  }
  _id() { return `s_${Date.now().toString(36)}_${crypto.randomBytes(8).toString('hex')}`; }
  _validId(id) { return /^[A-Za-z0-9._:-]{1,128}$/.test(String(id || '')); }
  _validAgent(id) { return /^[A-Za-z0-9._:-]{16,128}$/.test(String(id || '')); }
  _state(s, now = Date.now()) {
    if (s.closedAt) return 'closed';
    if (s.activeJobs.size) return 'hold';
    if (s.expiredAt) return 'expired';
    if (now - s.lastSeenAt >= this.idleMs) {
      s.expiredAt = now;
      if (this.agentSessions.get(s.agentId) === s.id) this.agentSessions.delete(s.agentId);
      this.emit({ type:'session_expired', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, status:'expired', idleMs:this.idleMs });
      return 'expired';
    }
    return 'active';
  }
  _view(s, now = Date.now()) {
    const state = this._state(s, now);
    return {
      sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, openId:s.openId || null, label:s.label, workspace:s.workspace, implicit:s.implicit, state,
      createdAt:s.createdAt, lastSeenAt:s.lastSeenAt, closedAt:s.closedAt, expiredAt:s.expiredAt,
      expiresAt: state === 'active' ? s.lastSeenAt + this.idleMs : null,
      holdReason: state === 'hold' ? 'active_job' : null, activeJobs:[...s.activeJobs],
      connectCount:s.connectCount, reconnectCount:s.reconnectCount,
      stats:{ ...s.stats }
    };
  }
  _owner(s, agentId) {
    const aid = String(agentId || '').trim();
    if (!this._validAgent(aid)) throw new SessionError('invalid_agent_id');
    if (s.agentId !== aid) throw new SessionError('session_owner_mismatch', 409);
    return aid;
  }
  prune(now = Date.now()) {
    for (const [id,s] of this.sessions) {
      const state = this._state(s, now);
      const terminalAt = s.closedAt || s.expiredAt;
      if ((state === 'closed' || state === 'expired') && terminalAt && now - terminalAt > this.historyMs) {
        this.sessions.delete(id);
        if (s.openId) this.openDedupe.delete(s.openId);
        if (this.agentSessions.get(s.agentId) === id) this.agentSessions.delete(s.agentId);
      }
    }
  }
  activeCount(now = Date.now()) {
    this.prune(now);
    let n=0; for (const s of this.sessions.values()) if (['active','hold'].includes(this._state(s, now))) n++;
    return n;
  }
  open({ id = null, openId = null, agentId, label = '', workspace = '', implicit = false } = {}) {
    this.prune();
    const aid = String(agentId || '').trim();
    if (!this._validAgent(aid)) throw new SessionError('invalid_agent_id');
    const liveId = this.agentSessions.get(aid), live = liveId ? this.sessions.get(liveId) : null;
    if (live && ['active','hold'].includes(this._state(live))) {
      this.emit({ type:'session_reused_for_agent', sessionId:live.id, agentId:aid, nodeId:live.nodeId, status:this._state(live) });
      return this._view(live);
    }
    if (liveId) this.agentSessions.delete(aid);
    const stableOpenId = openId == null || openId === '' ? null : String(openId);
    if (stableOpenId && !/^[A-Za-z0-9._:-]{16,128}$/.test(stableOpenId)) throw new SessionError('invalid_session_open_id');
    if (stableOpenId) {
      const priorId=this.openDedupe.get(stableOpenId), prior=priorId ? this.sessions.get(priorId) : null;
      if (prior) {
        this._owner(prior, aid);
        const state=this._state(prior);
        if (state === 'expired' || state === 'closed') throw new SessionError('session_open_id_expired', 410);
        return this._view(prior);
      }
      if (priorId) this.openDedupe.delete(stableOpenId);
    }
    if (this.activeCount() >= this.maxActive) throw new SessionError('session_capacity_reached', 429);
    const sessionId = id ? String(id) : this._id();
    if (!this._validId(sessionId)) throw new SessionError('invalid_session_id');
    if (this.sessions.has(sessionId)) throw new SessionError('session_already_exists', 409);
    const now=Date.now();
    const s={ id:sessionId, agentId:aid, nodeId:this.nodeId, openId:stableOpenId, label:String(label||'').slice(0,120), workspace:String(workspace||'').slice(0,512), implicit:Boolean(implicit),
      createdAt:now, lastSeenAt:now, closedAt:null, expiredAt:null, activeJobs:new Set(), connectCount:1, reconnectCount:0,
      stats:{ toolCalls:0, execCalls:0, jobsStarted:0, jobsFinished:0, outputReads:0, jobReads:0, errors:0 } };
    this.sessions.set(sessionId,s); this.agentSessions.set(aid, sessionId); if (stableOpenId) this.openDedupe.set(stableOpenId, sessionId);
    this.emit({ type:'session_opened', sessionId, agentId:aid, nodeId:s.nodeId, openId:stableOpenId, status:'active', label:s.label, workspace:s.workspace, implicit:s.implicit });
    return this._view(s, now);
  }
  ensure(id, { agentId, implicit = false } = {}) {
    const sessionId=String(id||'').trim();
    if (!this._validId(sessionId)) throw new SessionError('invalid_session_id');
    let s=this.sessions.get(sessionId);
    if (!s) {
      if (!implicit) throw new SessionError('session_not_found',404);
      this.open({ id:sessionId, agentId, label:'legacy/implicit', implicit:true });
      s=this.sessions.get(sessionId);
    }
    this._owner(s, agentId);
    const state=this._state(s);
    if (state === 'expired') throw new SessionError('session_expired',410);
    if (state === 'closed') throw new SessionError('session_closed',410);
    s.lastSeenAt=Date.now();
    return s;
  }
  resume(id, agentId) {
    const s=this.sessions.get(String(id||''));
    if (!s) throw new SessionError('session_not_found',404);
    this._owner(s, agentId);
    const state=this._state(s);
    if (state === 'expired') throw new SessionError('session_expired',410);
    if (state === 'closed') throw new SessionError('session_closed',410);
    s.lastSeenAt=Date.now(); s.connectCount++; s.reconnectCount++;
    this.emit({ type:'session_resumed', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, status:this._state(s), reconnectCount:s.reconnectCount });
    return this._view(s);
  }
  get(id, agentId = null) {
    const s=this.sessions.get(String(id||''));
    if (!s) throw new SessionError('session_not_found',404);
    if (agentId != null) this._owner(s, agentId);
    return this._view(s);
  }
  list() {
    this.prune();
    return [...this.sessions.values()].map(s=>this._view(s)).sort((a,b)=>b.createdAt-a.createdAt);
  }
  close(id, agentId) {
    const s=this.sessions.get(String(id||''));
    if (!s) throw new SessionError('session_not_found',404);
    this._owner(s, agentId);
    if (s.activeJobs.size) throw new SessionError('session_busy',409);
    if (!s.closedAt) {
      s.closedAt=Date.now();
      if (this.agentSessions.get(s.agentId) === s.id) this.agentSessions.delete(s.agentId);
      this.emit({ type:'session_closed', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, status:'closed' });
    }
    return this._view(s);
  }
  touch(id, agentId, action = 'tool') {
    const s=this.ensure(id, { agentId });
    s.stats.toolCalls++;
    s.lastSeenAt=Date.now();
    this.emit({ type:'session_activity', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, action:'toolCalls', tool:String(action||'tool').slice(0,120), status:this._state(s) });
    return this._view(s);
  }
  record(id, field) {
    const s=this.sessions.get(String(id||'')); if (!s) return;
    if (field in s.stats) s.stats[field]++;
    s.lastSeenAt=Date.now();
    this.emit({ type:'session_activity', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, action:field, status:this._state(s) });
  }
  attachJob(id, jobId) {
    const s=this.sessions.get(String(id||'')); if (!s) throw new SessionError('session_not_found',404);
    const wasHolding=s.activeJobs.size>0;
    s.activeJobs.add(jobId); s.stats.jobsStarted++; s.lastSeenAt=Date.now();
    if (!wasHolding) this.emit({ type:'session_hold_started', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, jobId, status:'hold' });
  }
  finishJob(id, jobId, jobStatus) {
    const s=this.sessions.get(String(id||'')); if (!s) return;
    s.activeJobs.delete(jobId); s.stats.jobsFinished++; s.lastSeenAt=Date.now();
    if (!s.activeJobs.size) this.emit({ type:'session_hold_released', sessionId:s.id, agentId:s.agentId, nodeId:s.nodeId, jobId, status:'active', jobStatus, graceMs:this.idleMs });
  }
}
