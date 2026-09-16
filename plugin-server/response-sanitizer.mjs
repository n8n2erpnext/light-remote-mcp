const OMIT_KEYS=new Set(['accountId','agentId','nodeId','requestId','operationId','commandId','sourceHash','publicIdentityKey','publicKey','publicKeySha256','telemetry','latency','pid']);
const SECRET_KEY=/(?:password|passwd|secret|api[_-]?key|private[_-]?key|authorization|cookie|token)$/i;
const INTERNAL_TIME=/^(?:createdAt|startedAt|finishedAt|lastSeenAt|lastActivityAt|firstOutputAt|completedAt|dispatchAt|operatorAcceptedAt|gatewayAcceptedAt|bridgeReceivedAt|deviceReceivedAt)$/;

export function redactRestrictedText(value){
  let text=String(value??'');
  text=text.replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]');
  text=text.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/ig,'$1[REDACTED]');
  text=text.replace(/(bearer\s+)[A-Za-z0-9._~+\/-]{20,}/ig,'$1[REDACTED]');
  text=text.replace(/((?:password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)[^\s"']+/ig,'$1[REDACTED]');
  text=text.replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,'[REDACTED SECRET]');
  return text;
}

export function sanitizeForMcp(value){
  if(value==null||typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='string')return redactRestrictedText(value);
  if(Array.isArray(value))return value.map(sanitizeForMcp);
  if(typeof value!=='object')return String(value);
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(OMIT_KEYS.has(key)||SECRET_KEY.test(key)||INTERNAL_TIME.test(key))continue;
    out[key]=sanitizeForMcp(item);
  }
  return out;
}
