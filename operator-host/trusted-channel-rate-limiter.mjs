import crypto from 'node:crypto';

// Redis-backed, signed-device-scoped fixed-minute budgets. The calling route
// MUST validate the signed device proof before consuming the budget.
const ACTION_LANES=Object.freeze({
  poll:'runtime',pulse:'runtime',result:'runtime','update-report':'runtime',stream:'runtime',
  'desktop-live-push':'rm-live',
  'fleet-intent':'fleet','fleet-authority':'fleet','fleet-status':'fleet',
  'fleet-devices':'fleet','fleet-sessions':'fleet','fleet-activity':'fleet',
  status:'observer',activity:'observer','access-lookup':'control'
});
const LUA_INCREMENT="local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n";
export class TrustedChannelRateLimitError extends Error {
  constructor(lane,retryAfterSeconds){
    super('rate_limited');
    this.status=429;
    this.scope='device-channel-'+lane;
    this.retryAfterSeconds=retryAfterSeconds;
  }
}
export function createTrustedChannelRateLimiter({redis,prefix,limits}){
  if(!redis||typeof redis.eval!=='function')throw Error('gold_trusted_rate_redis_required');
  if(!/^lr:gold:[a-z0-9_-]+:$/.test(String(prefix||'')))throw Error('gold_trusted_rate_prefix_invalid');
  for(const lane of ['runtime','observer','fleet','control','rm-live']){
    if(!Number.isSafeInteger(limits?.[lane])||limits[lane]<1)throw Error('gold_trusted_rate_limit_invalid');
  }
  return {
    async check(deviceId,action,now=Date.now()){
      if(!/^[A-Za-z0-9._:-]{1,160}$/.test(String(deviceId||'')))throw Error('gold_trusted_rate_device_invalid');
      if(!Number.isSafeInteger(now)||now<0)throw Error('gold_trusted_rate_time_invalid');
      const lane=ACTION_LANES[action]||'control';
      const minute=Math.floor(now/60000),retryAfterSeconds=Math.max(1,Math.ceil((60000-(now%60000))/1000));
      const deviceHash=crypto.createHash('sha256').update(deviceId).digest('hex');
      const key=prefix+'rate:trusted:'+lane+':'+deviceHash+':'+minute;
      let count;
      try {
        count=Number(await redis.eval(LUA_INCREMENT,{keys:[key],arguments:['90']}));
      } catch {
        // Canonical Gold Redis unavailable: NEVER fall back to a new local quota.
        const error=new Error('trusted_channel_rate_storage_unavailable');
        error.status=503;
        throw error;
      }
      if(!Number.isSafeInteger(count)||count<1){
        const error=new Error('trusted_channel_rate_invalid_response');
        error.status=503;
        throw error;
      }
      if(count>limits[lane])throw new TrustedChannelRateLimitError(lane,retryAfterSeconds);
      return {lane,remaining:Math.max(0,limits[lane]-count)};
    }
  };
}
