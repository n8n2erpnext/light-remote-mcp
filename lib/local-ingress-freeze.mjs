/**
 * Local, opt-in rc50 freeze gate. Covers HTTP ingress and explicitly tracked
 * background work in ONE PROCESS. This is NOT a global writer epoch/lease,
 * durable quiescence marker, or an Agent/fleet job drain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { durableAtomicWriteSync } from './durable-atomic-file.mjs';

export class LocalIngressFreezeGate {
  constructor({enabled=false,markerPath=null,service=null,persistMarker=durableAtomicWriteSync}={}){
    this.enabled=enabled===true;
    this.markerPath=markerPath;
    this.service=service;
    this.persistMarker=persistMarker;
    this.markerDurable=false;
    if(markerPath!==null){
      if(typeof markerPath!=='string'||!path.isAbsolute(markerPath)||
         !['operator','plugin'].includes(service))
        throw Error('LOCAL_FREEZE_MARKER_CONFIG_INVALID');
      // A frozen process MUST NOT restart as an open writer. Refuse startup
      // altogether rather than running registry startup side effects.
      try{
        const fd=fs.openSync(markerPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
        try{
          const st=fs.fstatSync(fd);
          if(!st.isFile()||st.nlink!==1||(st.mode&0o077)!==0)
            throw Error('LOCAL_FREEZE_MARKER_UNTRUSTED');
          const content=fs.readFileSync(fd,'utf8');
          const row=JSON.parse(content);
          if(Object.keys(row).sort().join(',')!=='phase,schemaVersion,service'||
             row.schemaVersion!==1||row.phase!=='freeze_requested'||row.service!==service)
            throw Error('LOCAL_FREEZE_MARKER_INVALID');
        }finally{fs.closeSync(fd);}
        throw Error('LOCAL_FREEZE_MARKER_PRESENT_STARTUP_REFUSED');
      }catch(error){
        if(error?.code!=='ENOENT')throw error;
      }
      const parent=fs.lstatSync(path.dirname(markerPath));
      if(!parent.isDirectory()||parent.isSymbolicLink()||(parent.mode&0o022)!==0)
        throw Error('LOCAL_FREEZE_MARKER_PARENT_UNTRUSTED');
    }
    this.phase='open';
    this.inflight=0;
    this.revision=0;
    this.waiters=new Set();
    this.pendingSources=new Map();
  }
  _externalPending(){
    let count=0;
    for(const getCount of this.pendingSources.values()){
      let n;
      try{n=getCount();}catch{return null;}
      if(!Number.isSafeInteger(n)||n<0)return null; // fail closed
      count+=n;
    }
    return count;
  }
  registerPendingSource(name,getCount){
    if(this.phase!=='open'||typeof name!=='string'||!name||
       typeof getCount!=='function'||this.pendingSources.has(name))
      throw Error('LOCAL_FREEZE_SOURCE_INVALID');
    this.pendingSources.set(name,getCount);
  }
  notifyPendingChanged(){this._finishDrain();}
  snapshot(){return Object.freeze({enabled:this.enabled,phase:this.phase,
    markerDurable:this.markerDurable,
    inflight:this.inflight,pendingExternal:this._externalPending(),
    revision:this.revision,drained:this.phase==='frozen'});}
  get accepting(){return this.phase==='open';}
  beginWork(){
    if(!this.accepting)return null;
    ++this.inflight;
    let released=false;
    return ()=>{
      if(released)return false;
      released=true;
      --this.inflight;
      if(this.phase==='freezing'&&this.inflight===0)this._finishDrain();
      return true;
    };
  }
  admitHttp(req,res,{health=false}={}){
    // Health must not bypass mutator inspection: only the caller's fixed
    // explicit /healthz route may be reported during a freeze.
    if(!this.accepting&&!health){
      res.statusCode=503;
      res.setHeader?.('retry-after','60');
      res.setHeader?.('cache-control','no-store');
      res.setHeader?.('content-type','application/json; charset=utf-8');
      res.end?.(JSON.stringify({ok:false,error:'local_ingress_frozen'}));
      return false;
    }
    if(health)return true;
    const done=this.beginWork();
    if(!done){
      res.statusCode=503;
      res.end?.(JSON.stringify({ok:false,error:'local_ingress_frozen'}));
      return false;
    }
    // HTTP streaming/SSE counts as open until finish/close. Never assume a
    // completed handler means the accepted network request is drained.
    const finish=()=>{res.removeListener?.('finish',finish);
      res.removeListener?.('close',finish);done();};
    res.once('finish',finish);
    res.once('close',finish);
    return true;
  }
  _finishDrain(){
    if(this.phase!=='freezing'||(this.markerPath&&!this.markerDurable)||
       this.inflight!==0||this._externalPending()!==0)return;
    this.phase='frozen';
    for(const done of this.waiters)done(this.snapshot());
    this.waiters.clear();
  }
  freeze(){
    if(!this.enabled)throw Error('LOCAL_FREEZE_NOT_OPTED_IN');
    if(this.phase==='open'){
      this.phase='freezing';++this.revision;
      if(this.markerPath){
        this.persistMarker(this.markerPath,
          JSON.stringify({schemaVersion:1,service:this.service,phase:'freeze_requested'})+'\n',
          {mode:0o600});
      }
      this.markerDurable=Boolean(this.markerPath);
    }
    this._finishDrain();
    if(this.phase==='frozen')return Promise.resolve(this.snapshot());
    return new Promise(resolve=>this.waiters.add(resolve));
  }
  // No unfreeze method. When a durable marker exists, startup is refused.
  // Deleting it requires external owner reconciliation, never automatic TTL.
}
