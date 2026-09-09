import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { MAX_GET_PAYLOAD_CHARS, decodeLegacyPayload, normalizeExecPayload, normalizeSessionOpenPayload, payloadFor } = require('../../lib/operator-request');

function expectError(fn,message,status=400){
  try{ fn(); }catch(error){
    if(error.message!==message||error.status!==status) throw new Error(`expected_${message}_${status}_got_${error.message}_${error.status}`);
    return;
  }
  throw new Error(`expected_error_${message}`);
}
function b64(value){ return Buffer.from(JSON.stringify(value)).toString('base64url'); }

const sample={agentId:'agent-transport-test-aaaaaaaa',openId:'open-transport-test-aaaaaaaa',label:'transport'};
const encoded=b64(sample);
if(JSON.stringify(decodeLegacyPayload(encoded))!==JSON.stringify(sample)) throw new Error('legacy_roundtrip_failed');
expectError(()=>decodeLegacyPayload('abc$'),'invalid_payload_encoding');
expectError(()=>decodeLegacyPayload('a'.repeat(MAX_GET_PAYLOAD_CHARS+1)),'payload_too_large_use_post',414);

const structured={action:'exec',payload:{operationId:'transport-op-aaaaaaaa',script:'x'.repeat(100000),sessionId:'s_test',agentId:'agent-transport-test-aaaaaaaa'}};
if(payloadFor({method:'POST',body:structured})!==structured.payload) throw new Error('structured_body_not_preserved');
const normalized=normalizeExecPayload(structured.payload);
if(normalized.script.length!==100000||normalized.operationId!==structured.payload.operationId) throw new Error('structured_exec_changed');
const tooLarge={...structured.payload,script:'x'.repeat(1024*1024+1)};
expectError(()=>normalizeExecPayload(tooLarge),'script_too_large',413);
const opened=normalizeSessionOpenPayload({...sample,leaseMs:600000,leasePreset:'custom'});
if(opened.leaseMs!==600000||opened.leasePreset!=='custom'||opened.agentId!==sample.agentId) throw new Error('session_open_normalization_failed');
expectError(()=>normalizeSessionOpenPayload({...sample,leaseMs:'nope'}),'invalid_session_lease');
expectError(()=>normalizeSessionOpenPayload({...sample,leasePreset:'bad preset'}),'invalid_session_lease_preset');
console.log(`operator-transport-legacy-limit=${MAX_GET_PAYLOAD_CHARS}`);
console.log('operator-transport-strict-base64url=PASS');
console.log('operator-transport-post-body=PASS');
console.log('operator-transport-script-limit=PASS');
