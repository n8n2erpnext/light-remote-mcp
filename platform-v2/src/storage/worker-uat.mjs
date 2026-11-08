/**
 * Isolated rc50-v2 test coordinator for PostgreSQL lease/outbox routines.
 * Dependency injected. Never imports production Operator, network clients or secrets.
 * Cannot start until verified with exact UAT database AND explicit trusted checks.
 */
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const HASH=/^[0-9a-f]{64}$/;
const verify=(ok,code)=>{if(!ok)throw new Error(code);};

export class WorkerUatCoordinator {
  #ready=false;
  constructor({db,allowUat=false,authorizeClaim,authorizeOutbox}={}){
    verify(allowUat===true,'worker_uat_only');
    verify(db&&typeof db.verifyTarget==='function'&&db.pool&&typeof db.pool.query==='function','verified_postgres_repository_required');
    verify(typeof authorizeClaim==='function','trusted_dispatch_proof_required');
    verify(typeof authorizeOutbox==='function','trusted_outbox_consumer_policy_required');
    this.db=db;this.authorizeClaim=authorizeClaim;this.authorizeOutbox=authorizeOutbox;
  }
  async initialize(){
    const row=await this.db.verifyTarget();
    verify(row?.database==='light_remote_rc50_uat','worker_wrong_database');
    this.#ready=true;
    return {database:row.database};
  }
  #assertReady(){verify(this.#ready,'worker_coordinator_not_initialized')}
  async claim({ownerId,actorId,deviceId,jobId,leaseTokenHash,leaseSeconds=120}){
    this.#assertReady();
    verify([ownerId,actorId,deviceId,jobId].every(x=>ID.test(String(x||''))),'invalid_worker_identity');
    verify(HASH.test(String(leaseTokenHash||'')),'invalid_worker_hash');
    verify(Number.isSafeInteger(leaseSeconds)&&leaseSeconds>=5&&leaseSeconds<=900,'invalid_worker_lease');
    verify(await this.authorizeClaim({ownerId,actorId,deviceId,jobId}),'worker_dispatch_denied');
    const {rows}=await this.db.pool.query(
      'SELECT slot_number,generation FROM lr_claim_worker_slot($1,$2,$3,$4)',
      [deviceId,jobId,leaseTokenHash,leaseSeconds]);
    return rows?.[0]||null;
  }
  async renew({jobId,leaseTokenHash,generation,leaseSeconds=120}){
    this.#assertReady();this.#checkFence(jobId,leaseTokenHash,generation);
    verify(Number.isSafeInteger(leaseSeconds)&&leaseSeconds>=5&&leaseSeconds<=900,'invalid_renew_lease');
    const {rows}=await this.db.pool.query(
      'SELECT lr_renew_worker_lease($1,$2,$3,$4) AS renewed',
      [jobId,leaseTokenHash,generation,leaseSeconds]);
    return rows?.[0]?.renewed===true;
  }
  async finish({jobId,leaseTokenHash,generation,succeeded}){
    this.#assertReady();this.#checkFence(jobId,leaseTokenHash,generation);
    verify(typeof succeeded==='boolean','invalid_job_result');
    const {rows}=await this.db.pool.query(
      'SELECT lr_finish_worker_job($1,$2,$3,$4) AS finished',
      [jobId,leaseTokenHash,generation,succeeded]);
    return rows?.[0]?.finished===true;
  }
  #checkFence(jobId,hash,generation){
    verify(ID.test(String(jobId||''))&&HASH.test(String(hash||'')),'invalid_fence');
    verify(Number.isSafeInteger(generation)&&generation>0,'invalid_fence_generation');
  }
  async claimOutbox({consumerId,limit=10,leaseSeconds=60}){
    this.#assertReady();verify(ID.test(String(consumerId||'')),'invalid_consumer');
    verify(Number.isSafeInteger(limit)&&limit>=1&&limit<=100,'invalid_batch_limit');
    verify(await this.authorizeOutbox({consumerId}),'outbox_consumer_denied');
    const {rows}=await this.db.pool.query(
      'SELECT * FROM lr_claim_outbox($1,$2,$3)',[consumerId,limit,leaseSeconds]);
    return rows||[];
  }
  async ackOutbox({id,consumerId,generation}){
    this.#assertReady();this.#validateOutbox(id,consumerId,generation);
    const {rows}=await this.db.pool.query('SELECT lr_ack_outbox($1,$2,$3) AS acknowledged',[id,consumerId,generation]);
    return rows?.[0]?.acknowledged===true;
  }
  async retryOutbox({id,consumerId,generation,delaySeconds=5,error='retry'}){
    this.#assertReady();this.#validateOutbox(id,consumerId,generation);
    verify(Number.isSafeInteger(delaySeconds)&&delaySeconds>=1&&delaySeconds<=3600,'invalid_retry_delay');
    const {rows}=await this.db.pool.query('SELECT lr_retry_outbox($1,$2,$3,$4,$5) AS retried',
      [id,consumerId,generation,delaySeconds,String(error).slice(0,256)]);
    return rows?.[0]?.retried===true;
  }
  #validateOutbox(id,consumerId,generation){
    verify(/^[0-9]+$/.test(String(id)) && BigInt(id)>0n,'invalid_outbox_id');
    verify(ID.test(String(consumerId||'')),'invalid_consumer');
    verify(Number.isSafeInteger(generation)&&generation>0,'invalid_outbox_fence');
  }
}
