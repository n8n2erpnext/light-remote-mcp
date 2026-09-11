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
expect(api.includes("action==='authorize-begin'")&&api.includes("action==='authorize-poll'"),'plus_pairing_surface_missing');
expect(api.includes("plus_session_required")&&api.includes("plusSession"),'plus_session_gate_missing');
expect(api.includes("sealOperatorPayload(normalizeExecPayload"),'plus_bridge_exec_encryption_missing');
expect(api.includes("action==='session-open'")&&api.includes("action==='output'"),'plus_bridge_durable_surface_missing');
expect(server.includes("app.post('/plus/auth/begin'")&&server.includes('plusAuth.requireSession'),'plus_gateway_pairing_gate_missing');
expect(server.includes('plusAuth.requireAgent'),'plus_agent_binding_missing');
expect(server.includes('authenticateVercelPlusBridge')&&server.includes('authenticateVercel(req)'),'plus_oidc_environment_fallback_missing');
expect(security.includes('VERCEL_PLUS_BRIDGE_ENVIRONMENTS')&&security.includes('production,preview'),'plus_oidc_environment_set_missing');

const fakeWall={
  signOAuthToken(kind,payload){return `o1.${kind}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;},
  verifyOAuthToken(kind,token){if(kind!=='plus'||!String(token).startsWith('o1.plus.'))return null;return {scope:'operator',exp:Date.now()+60000,agentId:'agent-v09-plus-selftest-0001'};}
};
const plus=createPlusAuth(fakeWall);
let r=response(); plus.begin({body:{agentId:'agent-v09-plus-selftest-0001',label:'selftest'}},r);
expect(r.statusCode===201&&r.body?.authorization?.pollToken,'plus_begin_failed');
const {requestId,pollToken}=r.body.authorization;
r=response(); plus.poll({body:{requestId,pollToken}},r); expect(r.statusCode===202&&r.body?.status==='pending','plus_poll_pending_failed');
r=response(); plus.approve({params:{id:requestId}},r); expect(r.statusCode===200&&r.body?.authorization?.state==='approved','plus_approve_failed');
r=response(); plus.poll({body:{requestId,pollToken}},r); expect(r.statusCode===200&&r.body?.session?.token?.startsWith('o1.plus.'),'plus_poll_approved_failed');
let next=false; r=response(); plus.requireSession({get:()=>r.body?.session?.token||'o1.plus.payload.sig'},r,()=>{next=true;}); expect(next,'plus_session_verify_failed');
next=false; r=response(); plus.requireAgent({plusIdentity:{agentId:'agent-v09-plus-selftest-0001'},body:{agentId:'agent-v09-plus-selftest-0001'},query:{}},r,()=>{next=true;}); expect(next,'plus_agent_binding_failed');
r=response(); plus.requireAgent({plusIdentity:{agentId:'agent-v09-plus-selftest-0001'},body:{agentId:'agent-v09-plus-attacker-0002'},query:{}},r,()=>{}); expect(r.statusCode===403&&r.body?.error==='plus_agent_mismatch','plus_agent_mismatch_not_rejected');

console.log('v09-plus-vercel-pairing=PASS');
console.log('v09-plus-vercel-oidc=PASS');
console.log('v09-plus-vercel-durable-exec=PASS');
