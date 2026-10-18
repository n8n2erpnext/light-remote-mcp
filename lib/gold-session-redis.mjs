/**
 * Gold SessionRegistry transient authority in Redis 8, no JSON file.
 * Existing SessionRegistry remains the business logic; single Gold Operator
 * writer is fenced by its PostgreSQL advisory lock.
 */
const MUTATORS=['open','ensure','resume','hold','setWorkspace','close','closeByDevice','touch','record','attachJob','finishJob','prune'];
const TTL_SECONDS=7*24*60*60;
function snapshot(registry){
 return {schemaVersion:1,sessions:[...registry.sessions].map(([id,row])=>[id,{
  ...row,activeJobs:[...row.activeJobs]
 }]),openDedupe:[...registry.openDedupe],agentDeviceSessions:[...registry.agentDeviceSessions]};
}
export class GoldSessionRedis{
 constructor({client,prefix,prior=null}={}){
  if(!client||typeof client.get!=='function'||typeof client.set!=='function'||
     !/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
   throw Error('gold_session_redis_required');
  this.client=client;this.key=prefix+'runtime:sessions';this.prior=prior;this.pending=Promise.resolve();this.error=null;
 }
 static async open({client,prefix}){
  if(!/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))throw Error('gold_session_namespace_invalid');
  const json=await client.get(prefix+'runtime:sessions');
  let prior=null;
  if(json!==null){
   prior=JSON.parse(json);
   if(prior?.schemaVersion!==1||!Array.isArray(prior.sessions)||!Array.isArray(prior.openDedupe)||
      !Array.isArray(prior.agentDeviceSessions))throw Error('gold_session_redis_data_invalid');
  }
  return new GoldSessionRedis({client,prefix,prior});
 }
 mount(registry){
  if(!(registry?.sessions instanceof Map)||!(registry?.openDedupe instanceof Map)||
     !(registry?.agentDeviceSessions instanceof Map))throw Error('gold_session_registry_invalid');
  if(this.prior){
   registry.sessions=new Map(this.prior.sessions.map(([id,row])=>{
    if(!row||row.id!==id)throw Error('gold_session_identity_mismatch');
    // Running OS jobs are not assumed alive across an Operator restart.
    return [id,{...row,activeJobs:new Set(),holdReason:row.closedAt?'': 'operator_restart'}];
   }));
   registry.openDedupe=new Map(this.prior.openDedupe);
   registry.agentDeviceSessions=new Map(this.prior.agentDeviceSessions);
  }
  for(const name of MUTATORS){
   if(typeof registry[name]!=='function')continue;
   const original=registry[name];
   registry[name]=(...args)=>{
    try{return original.apply(registry,args)}
    finally{this.enqueue(snapshot(registry))}
   };
  }
  this.enqueue(snapshot(registry));
  return registry;
 }
 enqueue(state){
  if(this.error)throw this.error;
  const body=JSON.stringify(state);
  this.pending=this.pending.then(()=>this.client.set(this.key,body,{EX:TTL_SECONDS})).then(result=>{
   if(result!=='OK')throw Error('gold_redis_session_write_rejected');
  }).catch(error=>{
   this.error=Error('gold_redis_session_write_failed',{cause:error});
   throw this.error;
  });
  this.pending.catch(()=>{});
 }
 async flush(){await this.pending;if(this.error)throw this.error}
}
