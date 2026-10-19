import assert from 'node:assert/strict';
import {registerPluginTools} from '../../plugin-server/tools.mjs';

// Pure registry inspection: no OAuth login, device enumeration or execution.
const registered=new Map();
const server={registerTool(name,config,callback){
  assert.ok(!registered.has(name),'duplicate tool registration: '+name);
  assert.equal(typeof callback,'function');
  registered.set(name,config);
}};
registerPluginTools(server,{accountId:'acct_metadata_fixture',clientId:'client_metadata_fixture'});
assert.ok(registered.size>=55,'unexpectedly_missing_plugin_tools');
for(const [name,config] of registered){
  assert.ok(name.startsWith('light_remote_'));
  assert.ok(typeof config.title==='string'&&config.title.length>3, name+':title');
  assert.ok(typeof config.description==='string'&&config.description.length>12,name+':description');
  const a=config.annotations||{};
  for(const field of ['readOnlyHint','destructiveHint','openWorldHint','idempotentHint'])
    assert.equal(typeof a[field],'boolean',name+':annotation_'+field);
  assert.ok(!(a.readOnlyHint&&a.destructiveHint),name+':contradictory_readonly_destructive');
  const scopes=config.securitySchemes?.flatMap(x=>x.scopes||[])||[];
  assert.ok(scopes.length>=1,name+':scope_missing');
  assert.ok(scopes.every(x=>['remote:read','remote:write','remote:execute','remote:terminal'].includes(x)),name+':unexpected_scope');
  if(a.readOnlyHint)assert.ok(!scopes.includes('remote:execute')&&!scopes.includes('remote:write'),name+':read_only_excess_scopes');
}
const must={
 light_remote_exec:['remote:execute',false,true],
 light_remote_process:['remote:execute',false,true],
 light_remote_terminal_input:['remote:terminal',false,true],
 light_remote_list_devices:['remote:read',true,false],
 light_remote_inspect_device:['remote:read',true,false],
 light_remote_recent_activity:['remote:read',true,false],
 light_remote_read_file:['remote:read',true,false],
 light_remote_process_output:['remote:read',true,false],
 light_remote_scp_download_status:['remote:read',true,false],
 light_remote_scp_upload_chunk:['remote:write',false,false],
 light_remote_scp_upload_commit:['remote:write',false,true],
 light_remote_remove_device:['remote:write',false,true],
};
for(const [name,[scope,readOnly,destructive]] of Object.entries(must)){
 const config=registered.get(name);assert.ok(config,name+':required_tool_missing');
 assert.deepEqual(config.securitySchemes[0].scopes,[scope],name+':scope_changed');
 assert.equal(config.annotations.readOnlyHint,readOnly,name+':read_only_mismatch');
 assert.equal(config.annotations.destructiveHint,destructive,name+':destructive_mismatch');
}
console.log('G1_GOLD_MCP_TOOL_METADATA_CONTRACT=PASS registered='+registered.size);
