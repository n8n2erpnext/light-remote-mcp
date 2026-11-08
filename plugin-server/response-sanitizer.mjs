const BLOCKED_KEYS = new Set([
  'accountId','agentId','nodeId','requestId','operationId','commandId',
  'sourceHash','publicIdentityKey','publicKey','publicKeySha256','telemetry','latency','pid'
]);
const SECRET_NAME = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key)$/i;
const INTERNAL_TIME = /^(createdAt|startedAt|finishedAt|lastSeenAt|lastActivityAt|firstOutputAt|completedAt|dispatchAt|operatorAcceptedAt|gatewayAcceptedAt|bridgeReceivedAt|deviceReceivedAt)$/;

export function redactRestrictedText(input){
  let text=String(input??'');
  const rules=[
    [/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]'],
    [/(authorization\s*[:=]\s*bearer\s+)[^\s"'<>]+/ig,'$1[REDACTED]'],
    [/(bearer\s+)[A-Za-z0-9._~+\/-]{20,}/ig,'$1[REDACTED]'],
    [/(\b(?:password|passwd|secret|api[_-]?key|private[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)[^\s"'<>]+/ig,'$1[REDACTED]'],
    [/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,'[REDACTED SECRET]']
  ];
  for(const [pattern,replacement] of rules) text=text.replace(pattern,replacement);
  return text;
}

export function sanitizeForMcp(value,depth=0){
  if(depth>12) return '[TRUNCATED]';
  if(value==null||typeof value==='number'||typeof value==='boolean') return value;
  if(typeof value==='string') return redactRestrictedText(value);
  if(Array.isArray(value)) return value.slice(0,2000).map(item=>sanitizeForMcp(item,depth+1));
  if(typeof value!=='object') return redactRestrictedText(String(value));
  const out={};
  for(const [key,item] of Object.entries(value)){
    if(BLOCKED_KEYS.has(key)||SECRET_NAME.test(key)||INTERNAL_TIME.test(key)) continue;
    out[key]=sanitizeForMcp(item,depth+1);
  }
  return out;
}
