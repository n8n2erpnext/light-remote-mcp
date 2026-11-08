/**
 * rc50 P0 synthetic-only in-memory freeze epoch prototype.
 * NOT mounted in Operator/Plugin, no persistent epoch, no network or authority.
 * Caller-supplied lane acknowledgements are assertions, not durable evidence.
 */
export class SyntheticFreezeError extends Error {
  constructor(code){ super(code); this.name='SyntheticFreezeError'; this.code=code; }
}
const requireTrue=(value,code)=>{ if(!value)throw new SyntheticFreezeError(code); };
const FREEZE=/^lr_rc50_fake_[a-z0-9_-]{8,80}$/;
const LANES=Object.freeze([
  'operator_accounts_and_grants','plugin_oauth','billing_webhooks',
  'support_outbox','fleet_dispatch','google_oauth_pending'
]);
export const SYNTHETIC_FREEZE_LANES=LANES;

export class SyntheticFreezeEpochGuard {
  #state='OPEN';
  #epoch=null;
  #generation;
  #tickets=new Set();
  #next=0;
  #externalWork=null;
  #acks=new Map();
  constructor({generation=1}={}){
    requireTrue(Number.isSafeInteger(generation)&&generation>0,'invalid_source_generation');
    this.#generation=generation;
  }
  get state(){return this.#state;}
  get generation(){return this.#generation;}
  get pendingMutations(){return this.#tickets.size;}
  get freezeId(){return this.#epoch;}

  beginMutation(){
    requireTrue(this.#state==='OPEN','writer_fenced');
    const ticket='synthetic_mutation_'+(++this.#next);
    this.#tickets.add(ticket);
    return ticket;
  }
  finishMutation(ticket){
    requireTrue(this.#tickets.has(ticket),'unknown_mutation_ticket');
    this.#tickets.delete(ticket);
  }
  fence(freezeId){
    requireTrue(this.#state==='OPEN','freeze_transition_denied');
    requireTrue(typeof freezeId==='string'&&FREEZE.test(freezeId),'invalid_synthetic_freeze_id');
    this.#epoch=freezeId;
    this.#state='FENCED';
    return this.view();
  }
  reportExternalWork({jobs,ptys,commands}={}){
    requireTrue(this.#state==='FENCED','drain_not_fenced');
    for(const [name,value] of Object.entries({jobs,ptys,commands}))
      requireTrue(Number.isSafeInteger(value)&&value>=0,'invalid_external_work:'+name);
    this.#externalWork={jobs,ptys,commands};
    return this.view();
  }
  drain(){
    requireTrue(this.#state==='FENCED','drain_transition_denied');
    requireTrue(this.#tickets.size===0,'active_mutations_not_drained');
    requireTrue(this.#externalWork!==null,'missing_external_work_report');
    requireTrue(Object.values(this.#externalWork).every(x=>x===0),
      'active_external_jobs_or_pty');
    this.#state='DRAINED';
    return this.view();
  }
  acknowledgeLane(id,{flushAcknowledged=false,watermark='',generation}={}){
    requireTrue(this.#state==='DRAINED','ack_before_drain');
    requireTrue(LANES.includes(id),'unknown_freeze_lane');
    requireTrue(flushAcknowledged===true,'unflushed_lane:'+id);
    requireTrue(generation===this.#generation,'lane_generation_mismatch:'+id);
    requireTrue(typeof watermark==='string' && /^[a-zA-Z0-9._:-]{8,128}$/.test(watermark),
      'invalid_lane_watermark:'+id);
    requireTrue(!this.#acks.has(id),'duplicate_lane_ack:'+id);
    this.#acks.set(id,{generation,watermark});
  }
  checkpoint(){
    requireTrue(this.#state==='DRAINED','checkpoint_not_drained');
    requireTrue(this.#acks.size===LANES.length,'missing_lane_flush_ack');
    for(const lane of LANES)requireTrue(this.#acks.has(lane),'missing_lane_flush_ack:'+lane);
    this.#state='CHECKPOINTED';
    return this.view();
  }
  view(){
    return Object.freeze({
      status:'SYNTHETIC_ONLY_NOT_AUTHORITY',
      state:this.#state,
      freezeId:this.#epoch,
      generation:this.#generation,
      pendingMutations:this.#tickets.size,
      jobs:this.#externalWork?.jobs??null,
      ptys:this.#externalWork?.ptys??null,
      commands:this.#externalWork?.commands??null,
      acknowledgedLanes:this.#acks.size,
      realBackupProven:false,
      productionCutoverAuthorized:false
    });
  }
}
