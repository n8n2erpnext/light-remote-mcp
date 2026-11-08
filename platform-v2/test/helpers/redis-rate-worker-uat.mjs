import {RedisUatAuxiliary} from '../../src/storage/redis.mjs';
import {createRedisCliUatClient} from './redis-cli-uat.mjs';

// Dedicated independent Node process, never a live Operator/API instance.
const client=createRedisCliUatClient();
const limiter=new RedisUatAuxiliary({
  client,prefix:'lr:rc50:uat:auth:',allowUat:true
});
process.on('message',async msg=>{
  if(msg?.action!=='hit'||typeof msg.id!=='number')return;
  try{
    const result=await limiter.rateHit(msg.key,{
      limit:msg.limit,windowSeconds:msg.windowSeconds
    });
    process.send?.({id:msg.id,pid:process.pid,ok:true,result});
  }catch(error){
    process.send?.({id:msg.id,pid:process.pid,ok:false,error:String(error?.message||'redis_rate_error')});
  }
});
