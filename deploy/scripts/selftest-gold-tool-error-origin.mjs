import assert from 'node:assert/strict';
import {classifyPluginToolError} from '../../plugin-server/tool-error-classification.mjs';
import {operationView,result,pluginToolErrorResult} from '../../plugin-server/tools.mjs';

// Exercise the shared normal MCP result path used by filesystem, search,
// process, terminal, transfer and desktop tools (not thrown exceptions).
for(const [code,layer,nextAction,httpStatus] of [
 ['filesystem_path_not_found','filesystem','verify_path',404],
 ['filesystem_edit_conflict','filesystem_conflict','reread_and_confirm_expected_sha',409],
 ['invalid_process_id','process','verify_process_id',400],
 ['process_stdin_unavailable','process','inspect_process_stdin_state',409],
 ['process_not_running','process','inspect_process_state',409],
 ['invalid_terminal_id','terminal','verify_terminal_id',400],
 ['invalid_search_id','search','verify_search_id',400],
 ['scp_transfer_not_found','transfer','verify_transfer_id',404],
 ['target_node_capability_missing','fleet_admission','inspect_authorized_node_capabilities',403],
]){
 const negative={ok:false,data:{ok:false,error:code,status:httpStatus},job:{jobId:'fixture',state:'error',finishedAt:123,exitCode:1}};
 const projected=operationView(negative),transport=result(projected);
 assert.equal(transport.isError,true,code+':isError');
 assert.equal(projected.ok,false,code+':ok');
 assert.equal(projected.layer,layer,code+':layer');
 assert.equal(projected.retryable,false,code+':retryable');
 assert.equal(projected.nextAction,nextAction,code+':nextAction');
 assert.equal(projected.httpStatus,httpStatus,code+':status');
 assert.equal(projected.job.jobId,'fixture',code+':job-preserved');
 assert.equal(projected.data.error,code,code+':original-error-preserved');
}
// A known local path deny is a valid completed policy decision. Keep all
// machine-readable denial metadata but do not convert it into an opaque MCP
// INVALID_ARGUMENT exception on clients that unwrap isError as a tool failure.
const pathDenied=operationView({ok:false,data:{ok:false,error:'filesystem_path_outside_allowed_roots',status:403},
 job:{jobId:'path-fixture',state:'error',finishedAt:123,exitCode:1}});
const pathResult=result(pathDenied);
assert.equal(pathResult.isError,undefined,'expected path denial should not throw through MCP host');
assert.equal(pathResult.structuredContent.ok,false);
assert.equal(pathResult.structuredContent.layer,'device_local_policy');
assert.equal(pathResult.structuredContent.httpStatus,403);
assert.equal(pathResult.structuredContent.retryable,false);
assert.equal(pathResult.structuredContent.nextAction,'use_authorized_path');
assert.equal(pathResult.structuredContent.job.jobId,'path-fixture');
console.log('G3_EXPECTED_PATH_DENIAL_STAYS_STRUCTURED_AND_NONRETRYABLE=PASS');

const positive=operationView({ok:true,data:{ok:true,items:[]},job:{jobId:'okfixture',state:'ok',finishedAt:123}});
assert.equal(positive.ok,true);
assert.equal('layer' in positive,false,'success must not gain negative metadata');
assert.equal(result(positive).isError,undefined,'success does not set MCP isError');
const untrusted=operationView({ok:false,data:{error:'Bearer do-not-leak secret',status:400}});
assert.equal(untrusted.error,'operation_failed');
assert.equal(JSON.stringify({error:untrusted.error,layer:untrusted.layer,nextAction:untrusted.nextAction}).includes('do-not-leak'),false);

const cases=[
 ['operator_public_key_unavailable','plugin_configuration',false,'configure_operator_public_keys'],
 ['target_node_capability_missing','fleet_admission',false,'inspect_authorized_node_capabilities'],
 ['local_host_capability_missing','operator_admission',false,'inspect_local_host_capabilities'],
 ['operator_unavailable','operator_transport',true,'wait_for_operator_health'],
 ['filesystem_path_outside_allowed_roots','device_local_policy',false,'use_authorized_path'],
 ['device_connection_expired','authorization',false,'reauthorize_on_local_wall'],
 ['gold_postgres_persistence_unavailable','canonical_storage',true,'check_gold_postgres_health'],
 ['operation_effect_unknown','operation_reconciliation',false,'inspect_original_job_receipt'],
 ['operation_id_conflict','operation_reconciliation',false,'use_distinct_operation_id_for_new_intent'],
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
for(const code of ['operation_id_conflict','operation_effect_unknown']){
 const e=Object.assign(new Error(code),{status:409,payload:{originalJobId:'48cfdf66-a4e1-4063-b223-76f6f7410ea1'}});
 const out=pluginToolErrorResult(e);
 assert.equal(out.isError,undefined);
 assert.equal(out.structuredContent.ok,false);
 assert.equal(out.structuredContent.retryable,false);
 assert.equal(out.structuredContent.layer,'operation_reconciliation');
 assert.equal(out.structuredContent.httpStatus,409);
 assert.equal(out.structuredContent.originalJobId,e.payload.originalJobId);
}
assert.equal(pluginToolErrorResult(Object.assign(new Error('operator_unavailable'),{status:503})).isError,true);
console.log('G4_MCP_UNKNOWN_OR_CONFLICT_RETURNS_NONRETRYABLE_RECEIPT_HINT=PASS');
console.log('G1_PLUGIN_TOOL_ERROR_ORIGIN_CLASSIFICATION=PASS');
