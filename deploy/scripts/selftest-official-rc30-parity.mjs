import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { HELPER_GROUPS as DIRECT_GROUPS, helperOverview, helperGroup } from '../../plugin-server/tool-helper.mjs';

const require=createRequire(import.meta.url);
const { HELPER_GROUPS:LEGACY_GROUPS }=require('../../lib/plus-tool-helper.js');
const root=path.resolve(import.meta.dirname,'../..');
const text=file=>fs.readFileSync(path.join(root,file),'utf8');

const groupIds=['workspace','files','shell','transfer','desktop'];
assert.deepEqual(Object.keys(DIRECT_GROUPS),groupIds);
assert.deepEqual(Object.keys(LEGACY_GROUPS),groupIds);

const context={deviceId:'dev1',sessionId:'s_123',nodeId:'node1',platform:'win32',architecture:'x64',workspace:'C:/work',gracePreset:'60m'};
const menu=helperOverview(context);
assert.equal(menu.helperMode,'index-only');
assert.deepEqual(Object.keys(menu.groups),groupIds);
assert.equal(menu.target.sessionId,'s_123');
assert.match(menu.rule,/independently exposed/i);
assert.doesNotMatch(menu.rule,/call light_remote_connection_helper again|load.*chapter/i);

for(const id of groupIds){
  const chapter=helperGroup(id,context);
  assert.equal(chapter.helperMode,'group-detail');
  assert.equal(chapter.group,id);
  assert.ok(chapter.tools&&Object.keys(chapter.tools).length>0,'empty chapter '+id);
}

const files=helperGroup('files',context);
for(const key of ['list','read','read_many','stat','search_start','search_results','search_cancel','write','edit','mkdir','copy','move','delete'])assert.ok(files.tools[key],'files.'+key);
const shell=helperGroup('shell',context);
for(const key of ['exec','process_start','process_input','process_output','process_list','process_stop','terminal_start','terminal_input','terminal_output','terminal_resize','terminal_signal','terminal_list','terminal_stop','job','output'])assert.ok(shell.tools[key],'shell.'+key);
assert.equal(shell.platformGuide.defaultShell,'powershell');
const transfer=helperGroup('transfer',context);
for(const key of ['download_begin','download_chunk','download_status','download_cancel','upload_begin','upload_chunk','upload_commit','upload_status','upload_cancel'])assert.ok(transfer.tools[key],'transfer.'+key);
const desktop=helperGroup('desktop',context);
for(const key of ['status','attach','resume','detach','windows','frame','observe','semantic_attach','semantic_snapshot','semantic_events','semantic_detach','live_open','live_read','live_close','semantic_action','input_batch','action_await'])assert.ok(desktop.tools[key],'desktop.'+key);

const directHelperJson=JSON.stringify({menu,...Object.fromEntries(groupIds.map(id=>[id,helperGroup(id,context)]))});
for(const forbidden of ['client=<opaque-client>','/api/operator?via=plus','transfer-begin','transfer-chunk','transfer-commit'])assert.ok(!directHelperJson.includes(forbidden),'direct helper leaked Vercel-only contract: '+forbidden);

const tools=text('plugin-server/tools.mjs');
const adapter=text('plugin-server/operator-adapter.mjs');
const server=text('plugin-server/server.mjs');
const compat=text('plugin-server/legacy-tool-call-compat.mjs');
const publicTools=tools.slice(tools.indexOf('export function registerPluginTools'));

for(const name of [
  'light_remote_context','light_remote_session_control','light_remote_hold_session',
  'light_remote_read_multiple_files','light_remote_stat_path',
  'light_remote_search_files','light_remote_search_results','light_remote_cancel_search',
  'light_remote_filesystem','light_remote_copy_path','light_remote_move_path','light_remote_delete_path',
  'light_remote_process','light_remote_process_input','light_remote_process_output','light_remote_list_processes','light_remote_stop_process',
  'light_remote_terminal','light_remote_terminal_input','light_remote_terminal_output','light_remote_resize_terminal','light_remote_signal_terminal','light_remote_list_terminals','light_remote_stop_terminal',
  'light_remote_scp_download','light_remote_scp_download_chunk','light_remote_scp_download_status','light_remote_scp_download_cancel',
  'light_remote_scp','light_remote_scp_upload_chunk','light_remote_scp_upload_commit','light_remote_scp_upload_status','light_remote_scp_upload_cancel',
  'light_remote_desktop','light_remote_desktop_attach','light_remote_desktop_resume','light_remote_desktop_detach','light_remote_desktop_windows','light_remote_desktop_frame','light_remote_desktop_observe',
  'light_remote_semantic_attach','light_remote_semantic_snapshot','light_remote_semantic_events','light_remote_semantic_detach',
  'light_remote_desktop_live_open','light_remote_desktop_live_read','light_remote_desktop_live_close',
  'light_remote_desktop_input','light_remote_desktop_input_batch','light_remote_desktop_action_await'
])assert.ok(publicTools.includes("'"+name+"'"),'missing focused official tool '+name);

for(const field of ['helperGroup','contextLines','maxResults','requiredCapabilities','cdpEndpoint','targetId','urlMatch','full:z.boolean()'])assert.ok(tools.includes(field),'missing official schema field '+field);
assert.ok(tools.includes("screen:z.number().int().min(-1).max(31)"),'desktop all-screen sentinel regressed');
assert.ok(!publicTools.includes('operation:z.enum'),'public MCP tools must not multiplex model-callable operations');
assert.ok(tools.includes('const legacySchemas={'),'legacy schema compatibility missing');
assert.ok(compat.includes('CallToolRequestSchema')&&compat.includes('callLegacyMultiplexedTool'),'legacy tools/call compatibility missing');

for(const token of [
  "'/v1/agent-client/context'",'/resume','/hold','agent_client_temporarily_unavailable',
  "full:full?'1':'0'",'8*1024*1024'
])assert.ok(adapter.includes(token),'adapter parity missing '+token);

assert.doesNotMatch(server,/const INSTRUCTIONS=|instructions:INSTRUCTIONS/);
assert.match(server,/new McpServer\(\{name:'light-remote',version:MCP_SURFACE_VERSION\}\)/);

console.log('official_rc30_focused_tool_contract=PASS');
console.log('official_rc30_legacy_call_compat=PASS');
console.log('official_rc30_workspace_session_parity=PASS');
console.log('official_rc30_files_shell_transfer_parity=PASS');
console.log('official_rc30_real_remote_v2_parity=PASS');
console.log('official_rc30_vercel_only_transport_excluded=PASS');
