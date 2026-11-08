import assert from 'node:assert/strict';
import {authErrorResult,requireScopes} from '../../plugin-server/oauth.mjs';
import {registerPluginTools,callLegacyMultiplexedTool} from '../../plugin-server/tools.mjs';

const expected=(error,layer,nextAction)=>({ok:false,error,layer,retryable:false,nextAction});
const wantScope=expected('insufficient_scope','oauth_authorization','request_required_scope');
const missing=authErrorResult(['remote:read'],'insufficient_scope','Additional permission required: remote:read');
assert.equal(missing.isError,true);
assert.deepEqual(missing.structuredContent,wantScope);
assert.ok(missing._meta?.['mcp/www_authenticate']?.[0].includes('insufficient_scope'),'OAuth challenge preserved');
assert.ok(missing.content[0].text.includes('remote:read'),'legacy challenge readable');
const unauth=authErrorResult(['remote:read']);
assert.deepEqual(unauth.structuredContent,expected('invalid_token','oauth_authorization','authorize_plugin'));
const denied=requireScopes({accountId:'a',clientId:'c',scopes:['remote:read']},['remote:execute']);
assert.deepEqual(denied.structuredContent,wantScope);
assert.equal(requireScopes({accountId:'a',clientId:'c',scopes:['remote:read']},['remote:read']),null);

const callbacks=new Map();
registerPluginTools({registerTool(name,config,callback){callbacks.set(name,callback);}},{
 accountId:'metadata-fixture',clientId:'metadata-client',scopes:[]
});
const toolDenied=await callbacks.get('light_remote_list_devices')({});
assert.deepEqual(toolDenied.structuredContent,wantScope);
assert.ok(toolDenied._meta?.['mcp/www_authenticate']?.length===1);

// Legacy invalid *shape* is rejected before dispatch, not treated as a
// device/OS permission failure. No commands or sensitive file paths involved.
const legacyInvalid=await callLegacyMultiplexedTool(
 {accountId:'metadata-fixture',clientId:'metadata-client',scopes:['remote:write']},
 'light_remote_filesystem',{operation:'delete',sessionId:'invalid session'}
);
assert.equal(legacyInvalid.isError,true);
assert.deepEqual(legacyInvalid.structuredContent,expected(
 'invalid_tool_arguments','plugin_validation','correct_tool_input'));
assert.equal(legacyInvalid.content[0].text,'Invalid legacy Light Remote tool arguments.');
console.log('G1_MCP_OAUTH_AND_VALIDATION_ERROR_CONTRACT=PASS');
