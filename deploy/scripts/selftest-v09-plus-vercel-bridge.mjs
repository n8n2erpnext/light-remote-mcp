import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const text=file=>fs.readFileSync(new URL(file,root),'utf8');
function expect(value,message){if(!value)throw new Error(message);}

const api=text('api/operator.js');
const server=text('gateway/server.mjs');
const security=text('gateway/security.mjs');
expect(api.includes("const plus=wantsPlus && req.method==='GET'"),'plus_bridge_must_be_get_only');
expect(api.includes("VERCEL_ENV||''")&&api.includes("plus_bridge_preview_only"),'plus_bridge_preview_gate_missing');
expect(api.includes("sealOperatorPayload(normalizeExecPayload"),'plus_bridge_exec_encryption_missing');
expect(api.includes("action==='session-open'")&&api.includes("action==='output'"),'plus_bridge_durable_surface_missing');
expect(api.includes('plusCall=(path,options={})=>callOperator(path,options)'),'plus_bridge_must_not_forward_custom_session_header');
expect(server.includes('authenticateVercelPlusBridge'),'plus_bridge_oidc_verifier_missing');
expect(server.includes("app.post('/plus/execute'")&&server.includes("app.get('/plus/devices'"),'plus_gateway_routes_missing');
expect(security.includes("PLUS_BRIDGE_ENV = process.env.VERCEL_PLUS_BRIDGE_ENVIRONMENT || 'preview'"),'plus_preview_oidc_subject_missing');
console.log('v09-plus-vercel-preview-gate=PASS');
console.log('v09-plus-vercel-oidc=PASS');
console.log('v09-plus-vercel-durable-exec=PASS');
