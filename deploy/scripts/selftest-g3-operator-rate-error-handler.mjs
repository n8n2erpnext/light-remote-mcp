import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TrustedChannelRateLimitError, createTrustedChannelRateLimiter } from '../../operator-host/trusted-channel-rate-limiter.mjs';
const source=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
assert.ok(source.includes("import { createTrustedChannelRateLimiter, TrustedChannelRateLimitError }"));
assert.ok(!source.includes('DeviceChannelRateLimitError'),'Old undefined class must never be evaluated in the HTTP error handler');
assert.ok(source.includes('error instanceof TrustedChannelRateLimitError || (error?.status===503'));
assert.ok(source.includes(".includes(message)) ? error.status"));
assert.ok(source.includes("const limited=error instanceof TrustedChannelRateLimitError;"));
assert.ok(source.includes("'trusted_channel_rate_storage_unavailable','trusted_channel_rate_invalid_response'"));
console.log('G3_GOLD_OPERATOR_NO_UNDEFINED_RATE_ERROR_CLASS=PASS');

const limits={runtime:2,observer:1,fleet:2,control:2,'rm-live':2},prefix='lr:gold:uat:';
const good={eval:async()=>2},bad={eval:async()=>{throw Error('redis_down')}},invalid={eval:async()=>NaN};
const hit=createTrustedChannelRateLimiter({redis:good,prefix,limits});
await assert.rejects(()=>hit.check('safe-test-device','status',180000),e=>{
 assert.ok(e instanceof TrustedChannelRateLimitError);
 assert.equal(e.status,429);assert.equal(e.scope,'device-channel-observer');
 assert.equal(e.retryAfterSeconds,60);return true;
});
console.log('G3_GOLD_OPERATOR_REDIS_429_CLASS_AND_RETRY_METADATA=PASS');
for(const redis of [bad,invalid]){
 const lim=createTrustedChannelRateLimiter({redis,prefix,limits});
 await assert.rejects(()=>lim.check('safe-test-device','status',180000),e=>e.status===503&&
 ['trusted_channel_rate_storage_unavailable','trusted_channel_rate_invalid_response'].includes(e.message));
}
console.log('G3_GOLD_OPERATOR_REDIS_UNAVAILABLE_503_FAIL_CLOSED=PASS');
