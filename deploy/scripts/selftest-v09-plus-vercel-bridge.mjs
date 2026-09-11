import fs from 'node:fs';
import { createPlusAuth } from '../../gateway/plus-auth.mjs';
const root=new URL('../../',import.meta.url);
const text=file=>fs.readFileSync(new URL(file,root),'utf8');
function expect(value,message){if(!value)throw new Error(message);}
function response(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},type(){return this;},send(v){this.body=v;return this;},set(){return this;}};}

const api=text('api/operator.js');
const server=text('gateway/server.mjs');
const security=text('gateway/security.mjs');
expect(api.includes("const plus=wantsPlus && req.method==='GET'"),'plus_bridge_must_be_get_only');
expect(api.includes("action==='devices-bootstrap'")&&api.includes("action==='authorize-begin'")&&api.includes("action==='authorize-poll'"),'plus_pairing_surface_missing');
expect(api.includes("plus_session_required")&&api.includes("plusSession"),'plus_session_gate_missing');
expect(api.includes("sealOperatorPayload(normalizeExecPayload"),'plus_bridge_exec_encryption_missing');
expect(api.includes("action==='session-open'")&&api.includes("action==='output'"),'plus_bridge_durable_surface_missing');
expect(server.includes("app.post('/plus/auth/begin'")&&server.includes('plusAuth.requireSession'),'plus_gateway_pairing_gate_missing');
expect(server.includes('plusAuth.requireAgent')&&server.includes('plusAuth.requireGrantedNode'),'plus_device_grant_tool_gate_missing');
expect(server.includes("app.get('/plus/bootstrap/devices'")&&server.includes('/v1/device-access/execute'),'plus_device_grant_route_missing');
expect(api.includes('deviceId')&&api.includes('invalid_plus_device_id'),'plus_device_selection_missing');
expect(server.includes("s.deviceId===req.plusIdentity.deviceId"),'plus_sessions_must_be_device_filtered');
expect(!server.includes("wallApp.post('/api/plus-authorizations/:id/approve'")&&!server.includes("wallApp.post('/api/plus-authorizations/:id/deny'"),'hosted_wall_must_not_approve_device_access');
expect(text('gateway/plus-auth.mjs').includes('Approve on the device Local Wall')&&!text('gateway/plus-auth.mjs').includes('Approve for 1 hour'),'local_wall_approval_semantics_missing');
expect(server.includes("plusBridge:'owner-approved-device-access-grant-over-vercel'"),'health_device_grant_semantics_missing');
expect(!text('gateway/plus-auth.mjs').includes('SESSION_TTL_MS = 60 * 60 * 1000'),'plus_human_approval_must_not_be_fixed_one_hour');
expect(server.includes('authenticateVercelPlusBridge')&&server.includes('authenticateVercel(req)'),'plus_oidc_environment_fallback_missing');
expect(security.includes('VERCEL_PLUS_BRIDGE_ENVIRONMENTS')&&security.includes('production,preview'),'plus_oidc_environment_set_missing');

const fakeWall={
  signOAuthToken(kind,payload){return `o1.${kind}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;},
  verifyOAuthToken(kind,token){if(kind!=='plus'||!String(token).startsWith('o1.plus.'))return null;const parts=String(token).split('.');try{return JSON.parse(Buffer.from(parts[2],'base64url').toString());}catch{return null;}}
};
const grant={grantId:'dag_bridge_selftest_0001',deviceId:'dev_bridge_selftest',connectionId:'dc_bridge_selftest_0001',expiresAt:Date.now()+3600000};
const plus=createPlusAuth(fakeWall,{
  requestAccess:async()=>({access:{state:'approved',grant}}),
  assertGrant:async id=>({grant:{...grant,grantId:id},device:{nodeId:'arm'}})
});
let r=response(); await plus.begin({body:{agentId:'agent-v09-plus-selftest-0001',deviceId:grant.deviceId,label:'selftest'}},r);
expect(r.statusCode===200&&r.body?.session?.grantId===grant.grantId,'plus_existing_device_grant_not_reused');
const token=r.body.session.token;let next=false;
r=response(); await plus.requireSession({get:()=>token},r,()=>{next=true;});expect(next,'plus_session_verify_failed');
next=false;r=response();plus.requireAgent({body:{agentId:'agent-v09-plus-selftest-0002'},query:{}},r,()=>{next=true;});expect(next,'plus_multi_agent_same_grant_failed');
next=false;r=response();plus.requireGrantedNode({plusIdentity:{nodeId:'arm'},body:{agentId:'agent-v09-plus-selftest-0002',nodeId:'amd'},query:{}},r,()=>{next=true;});expect(!next&&r.statusCode===403&&r.body?.error==='plus_device_grant_target_mismatch','plus_cross_device_target_not_rejected');

console.log('v09-plus-vercel-pairing=PASS');
console.log('v09-plus-vercel-oidc=PASS');
console.log('v09-plus-vercel-durable-exec=PASS');
