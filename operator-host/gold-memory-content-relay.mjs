import crypto from 'node:crypto';
import {memoryActorKey,memoryDigest,memoryOperationId,memoryRef,normalizeMemoryRequest} from '../lib/gold-memory-operation.mjs';

// Content plane ONLY: no file, database, Redis, event or logger dependency.
// Expiry/restart loses the reply; a caller must reconcile, never replay a save.
export class GoldMemoryContentRelay {
 constructor({now=Date.now,ttlMs=120000,maxRows=64,maxBytes=8*1024*1024,
  actorKey=memoryActorKey,normalize=normalizeMemoryRequest,readRef=memoryRef,prefix='mem_'}={}){
  this.now=now;this.ttlMs=ttlMs;this.maxRows=maxRows;this.maxBytes=maxBytes;this.rows=new Map();this.bytes=0;
  Object.assign(this,{actorKey,normalize,readRef,prefix});
  this.timer=setInterval(()=>this.prune(),1000);this.timer.unref?.();
 }
 remove(ref){const row=this.rows.get(ref);if(row)this.bytes-=row.bytes;this.rows.delete(ref);}
 prune(){for(const [ref,row] of this.rows)if(this.now()>=row.expiresAt)this.remove(ref);}
 put(owner,operationId,input){
  this.prune();const key=this.actorKey(owner),id=memoryOperationId(operationId),request=this.normalize(input),digest=memoryDigest(request);
  for(const row of this.rows.values())if(row.key===key&&row.operationId===id){
   if(row.digest!==digest)throw Error('gold_memory_operation_conflict');return this.control(row);
  }
  const bytes=Buffer.byteLength(JSON.stringify(request));
  if(this.rows.size>=this.maxRows||this.bytes+bytes>this.maxBytes)throw Error('gold_memory_relay_busy');
  const row={key,operationId:id,requestRef:this.prefix+crypto.randomBytes(24).toString('hex'),digest,request,reply:null,bytes,expiresAt:this.now()+this.ttlMs};
  this.rows.set(row.requestRef,row);this.bytes+=bytes;return this.control(row);
 }
 control(row){return {requestRef:row.requestRef,requestDigest:row.digest,operationId:row.operationId,action:row.request.action};}
 owned(owner,ref){
  this.prune();const row=this.rows.get(this.readRef(ref));
  if(!row||row.key!==this.actorKey(owner))throw Error('gold_memory_content_unavailable');return row;
 }
 fetch(owner,ref,digest){const row=this.owned(owner,ref);if(row.digest!==digest)throw Error('gold_memory_operation_conflict');return {request:structuredClone(row.request),...this.control(row)};}
 push(owner,ref,reply){
  const row=this.owned(owner,ref);
  const errorPattern=this.prefix==='mem_'?/^gold_[a-z0-9_]{1,120}$/:/^api_worker_[a-z0-9_]{1,80}$/;
  if(!reply||typeof reply.ok!=='boolean'||(reply.ok!==true&&!errorPattern.test(reply.error??'')))throw Error('gold_memory_reply_invalid');
  // Strip unknown wrapper fields. Provider/local data remains only in RAM.
  const clean=reply.ok?{ok:true,action:row.request.action,result:reply.result}:{ok:false,error:reply.error};
  const encoded=JSON.stringify(clean);if(Buffer.byteLength(encoded)>1024*1024)throw Error('gold_memory_reply_too_large');
  if(row.reply){if(memoryDigest(row.reply)!==memoryDigest(clean))throw Error('gold_memory_reply_conflict');return {accepted:true};}
  const bytes=Buffer.byteLength(encoded);if(this.bytes+bytes>this.maxBytes)throw Error('gold_memory_relay_busy');
  row.reply=JSON.parse(encoded);row.bytes+=bytes;this.bytes+=bytes;return {accepted:true};
 }
 read(owner,ref){const row=this.owned(owner,ref);return row.reply?structuredClone(row.reply):{ok:false,pending:true};}
 dispose(){clearInterval(this.timer);this.rows.clear();this.bytes=0;}
}
