import fs from 'node:fs';

const tool=fs.readFileSync(new URL('../../gateway/remote-convenience-tools.mjs',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../../gateway/server.mjs',import.meta.url),'utf8');
const executor=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const vercel=fs.readFileSync(new URL('../../api/operator.js',import.meta.url),'utf8');
const docker=fs.readFileSync(new URL('../../gateway/Dockerfile',import.meta.url),'utf8');
const sync=fs.readFileSync(new URL('./sync-gateway.sh',import.meta.url),'utf8');
const required=[
  'light_remote_read_text_file','light_remote_list_directory','light_remote_write_text_file',
  'light_remote_search_start','light_remote_search_results','light_remote_search_cancel','light_remote_process_start','light_remote_process_input','light_remote_process_output','light_remote_process_list','light_remote_process_stop',
  'light_remote_stat_path','light_remote_make_directory','light_remote_copy_path','light_remote_move_path','light_remote_delete_path'
];
for(const name of required) if(!tool.includes(`registerTool('${name}'`)) throw new Error(`missing_convenience_tool:${name}`);
if(!tool.includes("operationId:opId")||!tool.includes("annotations:ann(false,true,true)")) throw new Error('convenience_mutation_contract_missing');
if(!tool.includes('sealOperatorPayload(payload)')) throw new Error('convenience_encrypted_exec_missing');
if(!tool.includes("action:'process'")||tool.includes("registerTool('light_remote_kill_process'")) throw new Error('native_process_tool_contract_missing');
if(!tool.includes("action:'search'")||tool.includes("registerTool('light_remote_search_text'")) throw new Error('native_search_tool_contract_missing');
if(!executor.includes("['exec_batch','fs','process','terminal','search','scp'].includes(payload.action)")) throw new Error('device_access_search_allowlist_missing');
if(!vercel.includes("action.startsWith('search-')")||!vercel.includes("['start','results','cancel'].includes(op)")) throw new Error('vercel_search_surface_missing');
if(!server.includes("registerConvenienceTools(server, tracked, identity)")) throw new Error('convenience_server_registration_missing');
if(!docker.includes('COPY gateway/*.mjs ./')) throw new Error('convenience_docker_packaging_missing');
if(!sync.includes('context: "${ROOT_DIR}"')||!sync.includes('dockerfile: gateway/Dockerfile')||!sync.includes('docker compose build "$SERVICE"')||!sync.includes('docker compose up -d --no-build --force-recreate "$SERVICE"')) throw new Error('convenience_gateway_sync_missing');
console.log('v09-convenience-tool-contract=PASS');
console.log('v09-convenience-idempotency-encryption=PASS');
