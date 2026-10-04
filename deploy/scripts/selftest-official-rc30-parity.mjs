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

for(const id of groupIds){
  const chapter=helperGroup(id,context);
  assert.equal(chapter.helperMode,'group-detail');
  assert.equal(chapter.group,id);
  assert.ok(chapter.tools&&Object.keys(chapter.tools).length>0,`empty chapter ${id}`);
}

const files=helperGroup('files',context);
for(const key of ['list','read','read_many','stat','search','write','edit','filesystem'])assert.ok(files.tools[key],`files.${key}`);
const shell=helperGroup('shell',context);
for(const key of ['exec','process','terminal','job','output'])assert.ok(shell.tools[key],`shell.${key}`);
assert.equal(shell.platformGuide.defaultShell,'powershell');
const transfer=helperGroup('transfer',context);
assert.equal(transfer.tools.download.scope,'remote:read');
assert.equal(transfer.tools.upload.scope,'remote:write');
const desktop=helperGroup('desktop',context);
assert.deepEqual(desktop.tools.observe.operations,['status','attach','resume','detach','windows','frame','observe','semantic-attach','semantic-snapshot','semantic-events','semantic-detach','live-open','live-close']);
assert.deepEqual(desktop.tools.input.operations,['act','input','run']);

const directHelperJson=JSON.stringify({menu,...Object.fromEntries(groupIds.map(id=>[id,helperGroup(id,context)]))});
for(const forbidden of ['client=<opaque-client>','/api/operator?via=plus','transfer-begin','transfer-chunk','transfer-commit'])assert.ok(!directHelperJson.includes(forbidden),`direct helper leaked Vercel-only contract: ${forbidden}`);

const tools=text('plugin-server/tools.mjs');
const adapter=text('plugin-server/operator-adapter.mjs');
const server=text('plugin-server/server.mjs');

for(const name of [
  'light_remote_context','light_remote_session_control','light_remote_read_multiple_files','light_remote_stat_path',
  'light_remote_scp_download','light_remote_scp','light_remote_desktop','light_remote_desktop_live_read','light_remote_desktop_input'
]) assert.ok(tools.includes(`'${name}'`),`missing official tool ${name}`);

for(const field of ['helperGroup','contextLines','maxResults','requiredCapabilities','cdpEndpoint','targetId','urlMatch','full:z.boolean()'])assert.ok(tools.includes(field),`missing official schema field ${field}`);
assert.ok(tools.includes("screen:z.number().int().min(-1).max(31)"),'desktop all-screen sentinel regressed');
assert.ok(tools.includes("operation:z.enum(['resume','hold'])"),'session resume/hold facade missing');
assert.ok(tools.includes("operation:z.enum(['mkdir','copy','move','delete'])"),'write-scoped filesystem mutations not isolated');
assert.ok(tools.includes("operation:z.enum(['download-begin','download-chunk','status','cancel'])"),'read-scoped SCP download facade missing');

for(const token of [
  "'/v1/agent-client/context'",'/resume','/hold','agent_client_temporarily_unavailable',
  "full:full?'1':'0'",'8*1024*1024'
]) assert.ok(adapter.includes(token),`adapter parity missing ${token}`);

assert.ok(server.includes('index-only tool-family menu'),'server helper-menu instructions missing');
assert.ok(server.includes('helperGroup=workspace, files, shell, transfer, or desktop'),'server helper drill-down instructions missing');

console.log('official_rc30_helper_menu=PASS');
console.log('official_rc30_workspace_session_parity=PASS');
console.log('official_rc30_files_shell_transfer_parity=PASS');
console.log('official_rc30_real_remote_v2_parity=PASS');
console.log('official_rc30_vercel_only_transport_excluded=PASS');
