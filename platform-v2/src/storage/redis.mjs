/**
 * Redis is supplementary: short-lived cache, rate limiter, queue signals.
 * Never write an authoritative entitlement/usage/billing entry into Redis.
 */
const PREFIX=/^lr:rc50:uat:[a-z0-9_-]+:$/;
export class RedisUatAuxiliary {
  constructor({client,prefix='lr:rc50:uat:cache:',allowUat=false}={}){
    if(allowUat!==true)throw new Error('redis_uat_mode_required');
    if(!PREFIX.test(prefix))throw new Error('invalid_redis_namespace');
    if(!client||typeof client.get!=='function'||typeof client.set!=='function'||typeof client.del!=='function')throw new Error('redis_client_required');
    this.client=client;this.prefix=prefix;
  }
  _key(id){
    if(!/^[a-zA-Z0-9_.:-]{1,128}$/.test(String(id||'')))throw new Error('invalid_cache_key');
    return this.prefix+id;
  }
  async cachePut(id,value,{ttlSeconds=60}={}){
    if(!Number.isSafeInteger(ttlSeconds)||ttlSeconds<1||ttlSeconds>3600)throw new Error('cache_ttl_invalid');
    return this.client.set(this._key(id),JSON.stringify(value),{EX:ttlSeconds});
  }
  async cacheGet(id){
    const json=await this.client.get(this._key(id));
    return json===null?null:JSON.parse(json);
  }
  async cacheInvalidate(id){return this.client.del(this._key(id));}
}
