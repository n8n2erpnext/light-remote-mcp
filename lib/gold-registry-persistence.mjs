/**
 * PostgreSQL-backed canonical state of existing Operator registries.
 * Retains synchronous domain/business APIs; writes queue against the real
 * PostgreSQL table and must be committed before successful HTTP response.
 * There is NO filesystem storage, SQLite database or sidecar Gold API.
 *
 * Gold runs one Operator writer at a time. Other writers need separate
 * row-level transactions before an additional Operator replica is enabled.
 */
const DOMAINS=Object.freeze({
 accounts:{maps:['accounts','sessions','oneTimeTokens','upgradeRequests','pendingRegistrations','googleSignupIntents','groups']},
 devices:{maps:['devices']},
 enrollments:{maps:['pending','bindings']},
 connections:{maps:['connections']},
 access_grants:{maps:['requests','grants']},
 agent_clients:{maps:['rows']},
 usage:{maps:['openConnections'],objects:['accounts'],scalars:['trackingSince']},
 licenses:{maps:['rows']},
 pro_teams:{maps:['teams','invites','teamGrants','notificationReads'],objects:['emailInviteEvents']},
 free_benefits:{objects:['families','buckets']},
 support_outbox:{objects:['rows']},
 paddle_billing:{objects:['state']},
 google_oauth:{objects:['config']}
});
function encoded(instance,spec){
 const payload={schemaVersion:1};
 for(const field of spec.maps||[]){
  if(!(instance[field] instanceof Map))throw Error('gold_registry_map_missing:'+field);
  payload[field]=[...instance[field].entries()];
 }
 for(const field of spec.objects||[])payload[field]=instance[field];
 for(const field of spec.scalars||[])payload[field]=instance[field];
 return payload;
}
function hydrate(instance,spec,data,domain){
 if(data===null)return;
 if(!data||data.schemaVersion!==1)throw Error('gold_registry_invalid_state:'+domain);
 for(const field of spec.maps||[]){
  const entries=data[field];
  if(!Array.isArray(entries)||entries.some(x=>!Array.isArray(x)||x.length!==2))
   throw Error('gold_registry_bad_entries:'+domain+':'+field);
  instance[field]=new Map(entries);
 }
 for(const field of spec.objects||[]){
  if(data[field]===null||typeof data[field]!=='object')
   throw Error('gold_registry_bad_object:'+domain+':'+field);
  instance[field]=data[field];
 }
 for(const field of spec.scalars||[]){
  if(data[field]===undefined)throw Error('gold_registry_bad_scalar:'+domain+':'+field);
  instance[field]=data[field];
 }
 if(domain==='accounts'){
  instance.byEmail=new Map();
  for(const [key,row] of instance.accounts){
   if(!row?.email||row.accountId!==key)throw Error('gold_account_identity_mismatch');
   const email=String(row.email).toLowerCase();
   if(instance.byEmail.has(email))throw Error('gold_account_email_duplicate');
   instance.byEmail.set(email,key);
  }
  instance._ensureGroups();
 }
 if(domain==='licenses'){
  instance.byHash=new Map();
  for(const [key,row] of instance.rows){
   if(row.licenseId!==key||!row.keyHash||instance.byHash.has(row.keyHash))
    throw Error('gold_license_identity_mismatch');
   instance.byHash.set(row.keyHash,key);
  }
 }
}
export class GoldRegistryPersistence{
 constructor({pool}={}){
  if(!pool||typeof pool.query!=='function')throw Error('gold_pg_registry_pool_required');
  this.pool=pool;this.snapshots=new Map();this.pending=Promise.resolve();
  this.errored=null;this.mounted=new Set();
 }
 static async open({pool}){
  const instance=new GoldRegistryPersistence({pool});
  const {rows}=await pool.query('SELECT domain,payload FROM lr_gold_registry_documents');
  for(const row of rows){
   if(instance.snapshots.has(row.domain))throw Error('gold_registry_duplicate_domain');
   instance.snapshots.set(row.domain,row.payload);
  }
  return instance;
 }
 mount(domain,instance){
  if(!Object.hasOwn(DOMAINS,domain)||this.mounted.has(domain))
   throw Error('gold_registry_domain_invalid_or_duplicate:'+domain);
  const spec=DOMAINS[domain],data=this.snapshots.get(domain)??null;
  hydrate(instance,spec,data,domain);
  // Disable legacy state files entirely. The original business logic remains.
  instance.stateFile=null;
  const store=this;
  const persist=()=>store.enqueue(domain,encoded(instance,spec));
  instance._persist=persist;
  instance._save=persist;
  this.mounted.add(domain);
  if(data===null)persist(); // New Gold database only, never import production files.
  return instance;
 }
 enqueue(domain,payload){
  if(this.errored)throw this.errored;
  const body=JSON.stringify(payload); // Capture the complete mutation synchronously.
  this.pending=this.pending.then(async()=>{
   await this.pool.query(
    'INSERT INTO lr_gold_registry_documents(domain,payload) VALUES($1,$2::jsonb) ON CONFLICT(domain) DO UPDATE SET payload=EXCLUDED.payload,revision=lr_gold_registry_documents.revision+1,updated_at=now()',
    [domain,body]);
  }).catch(error=>{
   this.errored=Error('gold_pg_registry_write_failed:'+domain,{cause:error});
   throw this.errored;
  });
  // Rejections are observed by flush(). Avoid unhandled promise warning before response.
  this.pending.catch(()=>{});
 }
 async flush(){
  await this.pending;
  if(this.errored)throw this.errored;
 }
}
