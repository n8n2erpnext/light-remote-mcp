import assert from 'node:assert/strict';
import {z} from 'zod';
import {registerPluginTools,PLUGIN_TOOL_SECURITY} from '../../plugin-server/tools.mjs';
import {helperOverview,helperGroup} from '../../plugin-server/tool-helper.mjs';
const registered=new Map();
registerPluginTools({registerTool(name,config,callback){assert(!registered.has(name),'duplicate_tool:'+name);registered.set(name,{...config,callback});return {name};}},{accountId:'selftest',agentId:'selftest-agent'});
const semantic=['invoke','click','focus','value','toggle','select','expand','collapse'];
const physical=['move','click','scroll','drag','type_text','write_text','press_key','launch_app'];
const newNames=[...semantic.map(x=>'light_remote_semantic_'+x),...physical.map(x=>'light_remote_desktop_'+x)];
const obsolete=['light_remote_desktop_input','light_remote_desktop_input_batch','light_remote_desktop_action_await'];
assert.equal(registered.size,80,'expected_public_tools');
for(const name of obsolete)assert(!registered.has(name),'unreviewable_multiplex_tool_still_public:'+name);
for(const name of newNames){
 const tool=registered.get(name);
 assert(tool,'missing_public_action:'+name);
 const schema=z.object(tool.inputSchema);
 const json=z.toJSONSchema(schema,{target:'draft-07'});
 assert.equal(json.properties.action,undefined,name+'_arbitrary_action');
 assert.equal(json.properties.events,undefined,name+'_arbitrary_event_batch');
 assert.equal(json.properties.operation,undefined,name+'_arbitrary_operation');
 assert.equal(json.additionalProperties,false,name+'_unknown_input_must_be_denied');
 assert.equal(tool.annotations.readOnlyHint,false);
 assert.equal(tool.annotations.destructiveHint,true);
 assert.equal(tool.annotations.openWorldHint,true);
 assert.deepEqual(PLUGIN_TOOL_SECURITY[name][0].scopes,['remote:execute']);
 assert.equal(tool.securitySchemes[0].type,'oauth2');
 assert(json.properties.await?.properties?.timeoutMs,name+'_optional_state_wait');
}
assert(registered.get('light_remote_semantic_value').inputSchema.value.safeParse('replacement').success);
assert(!registered.get('light_remote_semantic_value').inputSchema.value.safeParse({arbitrary:'object'}).success);
const click=z.object(registered.get('light_remote_desktop_click').inputSchema);
assert(click.safeParse({sessionId:'test',x:3,y:6}).success);
assert(!click.safeParse({sessionId:'test',events:[{type:'key',key:'ESC'}]}).data?.events,'generic_input_disallowed');
const menu=helperOverview();
const group=helperGroup('desktop');
for(const name of newNames){
 assert(menu.groups.desktop.tools.includes(name),'not_in_index:'+name);
 assert(Object.values(group.tools).some(x=>x.name===name),'not_in_desktop_details:'+name);
}
for(const name of obsolete){
 assert(!menu.groups.desktop.tools.includes(name),'obsolete_in_index:'+name);
 assert(!Object.values(group.tools).some(x=>x.name===name),'obsolete_in_desktop_details:'+name);
}
const helper=registered.get('light_remote_connection_helper');
const expected='Start here. Handles Local Wall A/B pairing and, when ready, returns/reuses the working context plus a compact tool-family menu. Call again with helperGroup=workspace|files|shell|transfer|desktop only when detailed syntax for that family is needed. OAuth account login alone never authorizes a device.';
assert.equal(helper.description,expected,'helper_must_match_current_live_metadata');
console.log('mcp_public_tool_registration_count='+registered.size);
console.log('mcp_legacy_generic_desktop_tools_not_exposed=PASS');
console.log('mcp_16_individual_actions_typed_and_annotated=PASS');
console.log('mcp_optional_await_not_operation_multiplexer=PASS');
console.log('mcp_helper_menu_matches_registration=PASS');
console.log('mcp_connection_helper_description_parity=PASS');
