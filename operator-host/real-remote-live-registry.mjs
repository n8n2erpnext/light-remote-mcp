const DEFAULT_TTL_MS=5*60*1000;
const DEFAULT_MAX_EVENTS=1200;

function cleanText(value,max=256){return String(value||'').slice(0,max);}
function key(deviceId,semanticSessionId){return cleanText(deviceId,160)+'|'+cleanText(semanticSessionId,160);}

export class RealRemoteLiveRegistry{
  constructor({ttlMs=DEFAULT_TTL_MS,maxEvents=DEFAULT_MAX_EVENTS}={}){
    this.ttlMs=Math.max(30_000,Math.min(Number(ttlMs)||DEFAULT_TTL_MS,30*60_000));
    this.maxEvents=Math.max(100,Math.min(Number(maxEvents)||DEFAULT_MAX_EVENTS,5000));
    this.rows=new Map();
  }
  _prune(now=Date.now()){
    for(const [k,row] of this.rows)if(now-row.updatedAt>this.ttlMs)this.rows.delete(k);
  }
  push({deviceId,sessionId,agentId,semanticSessionId,stateSeq=0,events=[],snapshot=null,displayTopologyId=null,cursor=null,foreground=null,resyncRecommended=false,closed=false,heartbeat=false,updatedAt=Date.now()}={}){
    this._prune(updatedAt);
    const did=cleanText(deviceId,160),sid=cleanText(sessionId,160),aid=cleanText(agentId,160),sem=cleanText(semanticSessionId,160);
    if(!did||!sid||!aid||!sem)throw new Error('real_remote_live_identity_required');
    const k=key(did,sem),current=this.rows.get(k);
    if(current&&(current.sessionId!==sid||current.agentId!==aid))throw new Error('real_remote_live_owner_mismatch');
    if(closed){this.rows.delete(k);return {closed:true,semanticSessionId:sem};}
    const row=current||{deviceId:did,sessionId:sid,agentId:aid,semanticSessionId:sem,openedAt:updatedAt,events:[],snapshot:null,snapshotSeq:0,stateSeq:0,displayTopologyId:null,cursor:null,foreground:null,resyncRecommended:false,updatedAt};
    const incoming=Array.isArray(events)?events:[];
    for(const event of incoming){
      const seq=Math.max(0,Number(event?.seq)||0);
      if(!seq||seq<=row.stateSeq)continue;
      row.events.push(event);
      if(seq>row.stateSeq)row.stateSeq=seq;
    }
    if(row.events.length>this.maxEvents)row.events.splice(0,row.events.length-this.maxEvents);
    const explicitSeq=Math.max(0,Number(stateSeq)||0);if(explicitSeq>row.stateSeq)row.stateSeq=explicitSeq;
    if(snapshot&&typeof snapshot==='object'){row.snapshot=snapshot;row.snapshotSeq=Math.max(row.snapshotSeq,Math.max(0,Number(snapshot.stateSeq)||row.stateSeq));}
    if(displayTopologyId!=null)row.displayTopologyId=cleanText(displayTopologyId,256);
    if(cursor&&typeof cursor==='object')row.cursor=cursor;
    if(foreground&&typeof foreground==='object')row.foreground=foreground;
    row.resyncRecommended=Boolean(resyncRecommended);
    row.updatedAt=updatedAt;
    row.heartbeat=Boolean(heartbeat);
    this.rows.set(k,row);
    return {semanticSessionId:sem,stateSeq:row.stateSeq,eventCount:row.events.length,snapshotSeq:row.snapshotSeq,updatedAt:row.updatedAt};
  }
  read({deviceId,sessionId,agentId,semanticSessionId,afterSeq=0,limit=200,includeSnapshot=true}={}){
    this._prune();
    const did=cleanText(deviceId,160),sid=cleanText(sessionId,160),aid=cleanText(agentId,160),sem=cleanText(semanticSessionId,160);
    const row=this.rows.get(key(did,sem));if(!row)throw new Error('real_remote_live_not_found');
    if(row.sessionId!==sid||row.agentId!==aid)throw new Error('real_remote_live_owner_mismatch');
    const after=Math.max(0,Number(afterSeq)||0),cap=Math.max(1,Math.min(Number(limit)||200,500));
    const pending=row.events.filter(event=>Math.max(0,Number(event?.seq)||0)>after);
    const events=pending.slice(0,cap),lastReturned=events.length?Math.max(...events.map(event=>Math.max(0,Number(event?.seq)||0))):after;
    const hasMore=pending.length>events.length;
    const snapshot=includeSnapshot&&row.snapshot&&row.snapshotSeq>after?row.snapshot:null;
    return {deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,semanticSessionId:row.semanticSessionId,stateSeq:row.stateSeq,updatedAt:row.updatedAt,ageMs:Math.max(0,Date.now()-row.updatedAt),displayTopologyId:row.displayTopologyId,cursor:row.cursor,foreground:row.foreground,resyncRecommended:row.resyncRecommended,events,hasMore,nextAfterSeq:hasMore?lastReturned:row.stateSeq,snapshot};
  }
  close({deviceId,sessionId,agentId,semanticSessionId}={}){
    return this.push({deviceId,sessionId,agentId,semanticSessionId,closed:true});
  }
}
