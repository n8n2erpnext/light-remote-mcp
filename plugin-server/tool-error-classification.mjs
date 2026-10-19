// Preserve existing MCP isError text for older clients while exposing
// machine-readable error ORIGIN. Never guess platform pre-dispatch outcomes:
// they never reach the Plugin and therefore cannot be classified here.
const KNOWN=Object.freeze({
  operator_public_key_unavailable:['plugin_configuration',false,'configure_operator_public_keys'],
  operator_public_keys_json_invalid:['plugin_configuration',false,'repair_operator_public_keys_format'],
  target_node_capability_missing:['fleet_admission',false,'inspect_authorized_node_capabilities'],
  local_host_capability_missing:['operator_admission',false,'inspect_local_host_capabilities'],
  target_node_offline:['fleet_admission',true,'wait_for_authorized_device'],
  target_node_draining:['fleet_admission',true,'wait_for_authorized_device'],
  target_node_channel_not_found:['fleet_admission',true,'check_authorized_device_channel'],
  filesystem_path_outside_allowed_roots:['device_local_policy',false,'use_authorized_path'],
  filesystem_path_not_found:['filesystem',false,'verify_path'],
  invalid_process_id:['process',false,'verify_process_id'],
  invalid_terminal_id:['terminal',false,'verify_terminal_id'],
  invalid_search_id:['search',false,'verify_search_id'],
  scp_transfer_not_found:['transfer',false,'verify_transfer_id'],
  device_connection_expired:['authorization',false,'reauthorize_on_local_wall'],
  invalid_envelope:['operator_envelope',false,'verify_operator_key_configuration'],
  unknown_kid:['operator_envelope',false,'verify_operator_key_rotation'],
  agent_client_temporarily_unavailable:['operator_transport',true,'retry_same_authorized_session'],
  operator_unavailable:['operator_transport',true,'wait_for_operator_health'],
  gold_postgres_persistence_unavailable:['canonical_storage',true,'check_gold_postgres_health'],
});
const SAFE_CODE=/^[a-z][a-z0-9_]{0,119}$/;
export function classifyPluginToolError(error){
  const raw=String(error?.message||'').trim();
  const code=SAFE_CODE.test(raw)?raw:'operation_failed';
  const row=KNOWN[code];
  return {
    ok:false,
    error:code,
    layer:row?.[0]||'unknown',
    retryable:row?.[1]??false,
    nextAction:row?.[2]||'inspect_sanitized_tool_error',
    ...(Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?{httpStatus:error.status}:{}),
  };
}
