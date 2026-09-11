import fs from 'node:fs';

const tool=fs.readFileSync(new URL('../../gateway/remote-convenience-tools.mjs',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../../gateway/server.mjs',import.meta.url),'utf8');
const docker=fs.readFileSync(new URL('../../gateway/Dockerfile',import.meta.url),'utf8');
const sync=fs.readFileSync(new URL('./sync-gateway.sh',import.meta.url),'utf8');
const required=[
  'light_remote_read_text_file','light_remote_list_directory','light_remote_write_text_file',
  'light_remote_search_text','light_remote_process_list','light_remote_kill_process'
];
for(const name of required) if(!tool.includes(`registerTool('${name}'`)) throw new Error(`missing_convenience_tool:${name}`);
if(!tool.includes("operationId:opId")||!tool.includes("annotations:ann(false,true,true)")) throw new Error('convenience_mutation_contract_missing');
if(!tool.includes('sealOperatorPayload(payload)')) throw new Error('convenience_encrypted_exec_missing');
if(!server.includes("registerConvenienceTools(server, tracked, identity)")) throw new Error('convenience_server_registration_missing');
if(!docker.includes('remote-convenience-tools.mjs')) throw new Error('convenience_docker_packaging_missing');
if(!sync.includes('remote-convenience-tools.mjs')) throw new Error('convenience_gateway_sync_missing');
console.log('v09-convenience-tool-contract=PASS');
console.log('v09-convenience-idempotency-encryption=PASS');
