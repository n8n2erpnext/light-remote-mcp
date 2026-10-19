import assert from 'node:assert/strict';
import {classifyPluginToolError} from '../../plugin-server/tool-error-classification.mjs';

const cases=[
 ['operator_public_key_unavailable','plugin_configuration',false,'configure_operator_public_keys'],
 ['target_node_capability_missing','fleet_admission',false,'inspect_authorized_node_capabilities'],
 ['local_host_capability_missing','operator_admission',false,'inspect_local_host_capabilities'],
 ['operator_unavailable','operator_transport',true,'wait_for_operator_health'],
 ['filesystem_path_outside_allowed_roots','device_local_policy',false,'use_authorized_path'],
 ['device_connection_expired','authorization',false,'reauthorize_on_local_wall'],
 ['gold_postgres_persistence_unavailable','canonical_storage',true,'check_gold_postgres_health'],
];
for(const [message,layer,retryable,nextAction] of cases){
 const o=classifyPluginToolError(Object.assign(new Error(message),{status:409}));
 assert.deepEqual(o,{ok:false,error:message,layer,retryable,nextAction,httpStatus:409});
}
const withSecret=classifyPluginToolError(new Error('Authorization Bearer myprivatekey at /home/gold-uat/private'));
assert.equal(withSecret.error,'operation_failed');
assert.equal(withSecret.layer,'unknown');
assert.equal(JSON.stringify(withSecret).includes('myprivatekey'),false,'never reflect unrestricted error text');
// A pre-dispatch platform refusal cannot be classified inside a Plugin call.
assert.equal(classifyPluginToolError(new Error('platform_pre_dispatch_denied')).layer,'unknown');
assert.equal(classifyPluginToolError(new Error('target_node_capability_missing')).layer,'fleet_admission');
assert.equal(classifyPluginToolError(new Error('unknown_code')).layer,'unknown');
assert.equal('httpStatus' in classifyPluginToolError(Object.assign(new Error('operator_unavailable'),{status:42})),false);
console.log('G1_PLUGIN_TOOL_ERROR_ORIGIN_CLASSIFICATION=PASS');
