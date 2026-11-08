const PLUS_BATCH_POLICY=Object.freeze({
  directPayloadBytes:6000,
  maxExecScriptBytes:32*1024,
  recommendedMaxSteps:8,
  recommendedTransferChunkBytes:3072
});

function batchError(message,status=413){
  const error=new Error(message);error.status=status;return error;
}
function payloadBytes(payload){return Buffer.byteLength(JSON.stringify(payload||{}),'utf8');}
function scriptBytes(payload){return Buffer.byteLength(String(payload?.script||''),'utf8');}
function inspectPlusExecPayload(payload,{transport='direct'}={}){
  const script=scriptBytes(payload),serialized=payloadBytes(payload);
  if(script>PLUS_BATCH_POLICY.maxExecScriptBytes)throw batchError('plus_exec_batch_too_large_split_required');
  if(transport==='direct'&&serialized>PLUS_BATCH_POLICY.directPayloadBytes)throw batchError('plus_exec_transfer_required');
  return {scriptBytes:script,payloadBytes:serialized,transport};
}
module.exports={PLUS_BATCH_POLICY,inspectPlusExecPayload,payloadBytes,scriptBytes};
