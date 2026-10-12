/**
 * Serial append barrier for the rc50 development Operator.
 *
 * A failed disk append is permanently latched in this process. Any later
 * barrier/append rejects instead of implying that earlier logs were persisted.
 * This does NOT fsync an already appended file or prove crash durability.
 */
export class AuditAppendBarrier {
  #write;
  #onFailure;
  #tail=Promise.resolve();
  #failure=null;
  constructor({write,onFailure=()=>{}}={}){
    if(typeof write!=='function'||typeof onFailure!=='function')
      throw new TypeError('audit_append_dependencies_required');
    this.#write=write;
    this.#onFailure=onFailure;
  }
  get failed(){return this.#failure!==null;}
  enqueue(batch){
    if(typeof batch!=='string'||!batch.length)
      return Promise.reject(new TypeError('audit_batch_required'));
    const task=this.#tail.then(()=>{
      if(this.#failure)throw this.#failure;
      return this.#write(batch);
    }).catch(error=>{
      if(!this.#failure){
        this.#failure=error instanceof Error?error:new Error(String(error));
        try{this.#onFailure(this.#failure);}catch{/* logging must not mask the failure */}
      }
      throw this.#failure;
    });
    // Keep the serialization tail settled while retaining a latched failure.
    this.#tail=task.then(()=>{},()=>{});
    return task;
  }
  async flush(){
    await this.#tail;
    if(this.#failure)throw this.#failure;
  }
}
