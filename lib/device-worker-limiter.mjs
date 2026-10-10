export class DeviceWorkerLimiter {
  constructor({limit=()=>1,maxWaiting=64}={}) {
    this.limit=limit;this.maxWaiting=maxWaiting;this.active=0;this.waiting=[];
  }
  size(){return this.active;}
  _cap(){return Math.max(1,Math.min(3,Number(this.limit())||1));}
  async run(fn){
    if(this.active>=this._cap()||this.waiting.length){
      if(this.waiting.length>=this.maxWaiting)throw new Error('device_worker_queue_full');
      // The releasing worker reserves our slot *before* resolving this promise.
      await new Promise(resolve=>this.waiting.push(resolve));
    }else this.active++;
    try{return await fn();}
    finally{
      this.active--;
      // Reserve available slots synchronously; queued and newly arriving work
      // can never both claim the same released capacity.
      while(this.waiting.length&&this.active<this._cap()){
        this.active++;
        this.waiting.shift()();
      }
    }
  }
}
export function planSessionCeiling(plan,configured=null){
  const key=String(plan||'free').toLowerCase();
  const fallback=['pro','vip'].includes(key)?3:2;
  const override=Number(configured);
  return Math.max(1,Math.min(Number.isInteger(override)&&override>0?override:fallback,5));
}
export const planWorkerLimit=(plan,requested=3)=>['pro','vip'].includes(String(plan||'').toLowerCase())
  ?Math.max(1,Math.min(3,Number(requested)||3)):1;
