export class DeviceWorkerLimiter {
  constructor({limit=()=>1,maxWaiting=64}={}) {
    this.limit=limit;this.maxWaiting=maxWaiting;this.active=0;this.waiting=[];
  }
  size(){return this.active;}
  _cap(){return Math.max(1,Math.min(3,Number(this.limit())||1));}
  async run(fn){
    if(this.active>=this._cap()||this.waiting.length) {
      if(this.waiting.length>=this.maxWaiting)throw new Error('device_worker_queue_full');
      await new Promise(resolve=>this.waiting.push(resolve));
    }
    this.active++;
    try{return await fn();}
    finally{
      this.active--;
      if(this.waiting.length&&this.active<this._cap())this.waiting.shift()();
    }
  }
}
export const planWorkerLimit=(plan,requested=3)=>['pro','vip'].includes(String(plan||'').toLowerCase())
  ?Math.max(1,Math.min(3,Number(requested)||3)):1;
