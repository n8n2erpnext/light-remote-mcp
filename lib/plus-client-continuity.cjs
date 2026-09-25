const crypto = require('node:crypto');

const DEFAULT_RETRY_DELAYS_MS = Object.freeze([250, 750, 1500, 3000]);

function classifyClientCapability(token,{now=Date.now()}={}){
  const raw=String(token||'');
  if(!raw)return {eligible:false,reason:'missing'};
  const parts=raw.split('.');
  if(parts.length!==4||parts[0]!=='o1'||parts[1]!=='client')return {eligible:false,reason:'shape'};
  let value;
  try{value=JSON.parse(Buffer.from(parts[2],'base64url').toString('utf8'));}
  catch{return {eligible:false,reason:'json'};}
  if(value?.scope!=='agent-client')return {eligible:false,reason:'scope'};
  if(!value?.clientSessionId)return {eligible:false,reason:'missing_client_id'};
  if(!value?.agentId)return {eligible:false,reason:'missing_agent_id'};
  const exp=Number(value.exp||0);
  if(!Number.isFinite(exp))return {eligible:false,reason:'exp_type'};
  if(exp<=now)return {eligible:false,reason:'expired',exp};
  return {
    eligible:true,
    reason:'eligible',
    clientSessionId:String(value.clientSessionId),
    agentId:String(value.agentId),
    exp,
    expRepresentation:Number.isSafeInteger(value.exp)?'integer':typeof value.exp
  };
}
function decodeClientCapability(token,{now=Date.now()}={}){
  const classified=classifyClientCapability(token,{now});
  if(!classified.eligible)return null;
  return {clientSessionId:classified.clientSessionId,agentId:classified.agentId,exp:classified.exp};
}
function clientFingerprint(token){
  return crypto.createHash('sha256').update(String(token||'')).digest('hex').slice(0,16);
}
function isTransientClientInvalid(error){
  if(Number(error?.status)!==401||String(error?.payload?.error||'')!=='agent_client_required')return false;
  const detail=String(error?.payload?.detail||'').trim().toLowerCase();
  return detail===''||detail==='invalid';
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
  const classification=classifyClientCapability(client,{now:now()});
  const capability=classification.eligible?classification:null;
  const fingerprint=clientFingerprint(client);
  let attempt=0;
  for(;;){
    try{
      const value=await call();
      if(attempt>0)onEvent({type:'client_continuity_recovered',attempt,fingerprint,decodeReason:classification.reason});
      return value;
    }catch(error){
      if(!capability||!isTransientClientInvalid(error))throw error;
      if(attempt>=delaysMs.length){
        onEvent({type:'client_continuity_exhausted',attempt,fingerprint,decodeReason:classification.reason});
        throw continuityUnavailable(error);
      }
      const delayMs=Math.max(0,Number(delaysMs[attempt])||0);
      attempt+=1;
      onEvent({type:'client_continuity_retry',attempt,delayMs,fingerprint,decodeReason:classification.reason});
      if(delayMs)await sleep(delayMs);
    }
  }
}

module.exports={
  DEFAULT_RETRY_DELAYS_MS,
  classifyClientCapability,
  decodeClientCapability,
  clientFingerprint,
  isTransientClientInvalid,
  continuityUnavailable,
  callWithClientContinuity
};
