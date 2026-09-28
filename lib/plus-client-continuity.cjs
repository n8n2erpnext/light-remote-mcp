const crypto = require('node:crypto');

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([250, 750, 1500, 3000]);

function decodeClientCapability(token,{now=Date.now()}={}){
  const parts=String(token||'').split('.');
  if(parts.length!==4||parts[0]!=='o1'||parts[1]!=='client')return null;
  try{
    const value=JSON.parse(Buffer.from(parts[2],'base64url').toString('utf8'));
    if(value?.scope!=='agent-client'||!value?.clientSessionId||!value?.agentId)return null;
    const exp=Number(value.exp||0);
    if(!Number.isFinite(exp)||exp<=now)return null;
    return {clientSessionId:String(value.clientSessionId),agentId:String(value.agentId),exp};
  }catch{return null;}
}
function clientFingerprint(token){
  return crypto.createHash('sha256').update(String(token||'')).digest('hex').slice(0,16);
}
function isTransientClientInvalid(error){
  return Number(error?.status)===401 &&
    String(error?.payload?.error||'')==='agent_client_required' &&
    String(error?.payload?.detail||'')==='invalid';
}
function continuityUnavailable(error,{retryAfterMs=5000}={}){
  const next=new Error('agent_client_temporarily_unavailable');
  next.status=503;
  next.cause=error;
  next.payload={
    ok:false,
    error:'agent_client_temporarily_unavailable',
    retryable:true,
    retryAfterMs,
    clientAction:'retry_same_client',
    detail:'continuity_revalidation_failed'
  };
  return next;
}
async function callWithClientContinuity(call,{
  client,
  delaysMs=DEFAULT_RETRY_DELAYS_MS,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  onEvent=()=>{},
  now=()=>Date.now()
}={}){
  const capability=decodeClientCapability(client,{now:now()});
  const fingerprint=clientFingerprint(client);
  let attempt=0;
  for(;;){
    try{
      const value=await call();
      if(attempt>0)onEvent({type:'client_continuity_recovered',attempt,fingerprint});
      return value;
    }catch(error){
      if(!capability||!isTransientClientInvalid(error))throw error;
      if(attempt>=delaysMs.length){
        onEvent({type:'client_continuity_exhausted',attempt,fingerprint});
        throw continuityUnavailable(error);
      }
      const delayMs=Math.max(0,Number(delaysMs[attempt])||0);
      attempt+=1;
      onEvent({type:'client_continuity_retry',attempt,delayMs,fingerprint});
      if(delayMs)await sleep(delayMs);
    }
  }
}

module.exports={
  DEFAULT_RETRY_DELAYS_MS,
  decodeClientCapability,
  clientFingerprint,
  isTransientClientInvalid,
  continuityUnavailable,
  callWithClientContinuity
};
