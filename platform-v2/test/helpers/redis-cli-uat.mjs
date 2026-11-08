import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// For isolated end-to-end tests ONLY. Runs redis-cli inside the private Redis
// container without publishing its TCP port or exposing the UAT test password.
// Not an application client and not suitable for API production traffic.
const execFileAsync=promisify(execFile);
const CONTAINER='lightremote-rc50-v2-redis-1';
const KEY=/^lr:rc50:uat:[a-z0-9_-]+:rate:[A-Za-z0-9_.:-]{1,128}$/;
const AUTH=`pass="$(sed -n 's/^requirepass[[:space:]]\\{1,\\}//p' /usr/local/etc/redis/redis.conf)"
test -n "$pass" || exit 12
pass="$(printf '%s' "$pass" | sed 's/^"//; s/"$//')"
export REDISCLI_AUTH="$pass"
exec redis-cli --raw "$@"`;

async function cli(args,{container=CONTAINER}={}){
  if(container!==CONTAINER)throw new Error('redis_uat_unapproved_container');
  const {stdout}=await execFileAsync('docker',[
    'exec',container,'sh','-ec',AUTH,'sh',...args
  ],{timeout:15000,maxBuffer:16384,encoding:'utf8'});
  const output=stdout.trim();
  if(output.startsWith('ERR ')||output.startsWith('NOAUTH '))throw new Error('redis_uat_command_error');
  return output;
}
export function createRedisCliUatClient({simulateOutage=false}={}){
  const exec=async args=>{
    if(simulateOutage)throw new Error('simulated_redis_transport_failure');
    return cli(args);
  };
  return {
    async eval(script,{keys,arguments:args}={}){
      if(!Array.isArray(keys)||keys.length!==1||!KEY.test(keys[0])||
        !Array.isArray(args)||args.length!==1||!/\d{1,4}$/.test(String(args[0]))||
        !script.includes("redis.call('INCR'")||
        !script.includes("redis.call('EXPIRE'"))throw new Error('unapproved_redis_uat_eval');
      const output=await exec(['EVAL',script,'1',keys[0],String(args[0])]);
      const result=output.split('\n').map(Number);
      if(result.length!==2||result.some(x=>!Number.isSafeInteger(x)))
        throw new Error('invalid_redis_uat_response');
      return result;
    },
    // RateHit requires client interface. Read/write cache operations are NOT
    // exercised through this CLI harness.
    get:async()=>{throw new Error('uat_cli_get_unsupported');},
    set:async()=>{throw new Error('uat_cli_set_unsupported');},
    async del(key){
      if(!KEY.test(key))throw new Error('uat_cli_cleanup_key_denied');
      const n=Number(await exec(['DEL',key]));
      if(!Number.isSafeInteger(n)||n<0)throw new Error('uat_cli_del_failed');
      return n;
    }
  };
}
