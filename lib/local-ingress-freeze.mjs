/**
 * Local, opt-in rc50 freeze gate. Covers HTTP ingress and explicitly tracked
 * background work in ONE PROCESS. This is NOT a global writer epoch/lease,
 * durable quiescence marker, or an Agent/fleet job drain.
 */
export class LocalIngressFreezeGate {
  constructor({enabled=false}={}){
    this.enabled=enabled===true;
    this.phase='open';
    this.inflight=0;
    this.revision=0;
    this.waiters=new Set();
  }
  snapshot(){return Object.freeze({enabled:this.enabled,phase:this.phase,
    inflight:this.inflight,revision:this.revision,drained:this.phase==='frozen'});}
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
    if(this.phase!=='freezing'||this.inflight!==0)return;
    this.phase='frozen';
    for(const done of this.waiters)done(this.snapshot());
    this.waiters.clear();
  }
  freeze(){
    if(!this.enabled)throw Error('LOCAL_FREEZE_NOT_OPTED_IN');
    if(this.phase==='open'){this.phase='freezing';++this.revision;}
    this._finishDrain();
    if(this.phase==='frozen')return Promise.resolve(this.snapshot());
    return new Promise(resolve=>this.waiters.add(resolve));
  }
  // No unfreeze method. Restart/reconciliation required to re-open ingress.
}
