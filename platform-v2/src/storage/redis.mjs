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

  /**
   * Atomic fixed-window limiter for synthetic UAT tests.
   * Redis failure MUST propagate as a rejection, never as unlimited access.
   * Not a quota/billing counter; never use for authoritative plan usage.
   */
  async rateHit(id,{limit=12,windowSeconds=600}={}){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100000)throw new Error('invalid_rate_limit');
    if(!Number.isSafeInteger(windowSeconds)||windowSeconds<1||windowSeconds>3600)throw new Error('invalid_rate_window');
    if(typeof this.client.eval!=='function')throw new Error('redis_atomic_eval_required');
    const key=this._key('rate:'+id);
    const script=`local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('TTL', KEYS[1])}`;
    let result;
    try{
      result=await this.client.eval(script,{keys:[key],arguments:[String(windowSeconds)]});
    }catch(error){
      throw new Error('rate_limit_backend_unavailable',{cause:error});
    }
    const [rawCount,rawTtl]=Array.isArray(result)?result:[];
    const count=Number(rawCount),ttl=Number(rawTtl);
    if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(ttl)||ttl<0)
      throw new Error('rate_limit_invalid_backend_response');
    return {allowed:count<=limit,remaining:Math.max(0,limit-count),count,retryAfterSeconds:count>limit?ttl:0};
  }
}
