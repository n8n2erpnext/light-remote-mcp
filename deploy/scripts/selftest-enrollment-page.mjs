import fs from 'node:fs';
import { enrollmentApprovalHtml } from '../../gateway/enrollment-page.mjs';

const id='enr_12345678-1234-1234-1234-123456789abc';
const html=enrollmentApprovalHtml(id);
if(!html.includes('Device enrollment')||!html.includes('/api/enrollments')||!html.includes('/api/enrollments/approve'))throw new Error('enrollment_page_contract_missing');
if(!html.includes(JSON.stringify(id)))throw new Error('enrollment_page_id_missing');
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(scripts.length!==1)throw new Error('enrollment_page_script_count');
new Function(scripts[0]);

const server=fs.readFileSync(new URL('../../gateway/server.mjs',import.meta.url),'utf8');
const required=[
  "app.post('/operator/enrollments/begin', softRateLimit, requireVercelIdentity",
  "app.post('/operator/enrollments/poll', softRateLimit, requireVercelIdentity",
  "app.post('/operator/devices/:id/heartbeat', softRateLimit, requireVercelIdentity",
  "app.get('/operator/enrollments', softRateLimit, requireOperatorIdentity",
  "app.post('/operator/enrollments/approve', softRateLimit, requireOperatorIdentity",
  "app.post('/operator/devices/:id/revoke', softRateLimit, requireOperatorIdentity",
  "wallApp.get('/enroll', accountWallAuth.requirePage",
  "wallApp.post('/api/enrollments/approve', accountWallAuth.requireApi"
];
for(const value of required)if(!server.includes(value))throw new Error(`gateway_enrollment_guard_missing:${value}`);

const executor=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const registry=fs.readFileSync(new URL('../../operator-host/enrollment-registry.mjs',import.meta.url),'utf8');
const accountPortal=fs.readFileSync(new URL('../../plugin-server/account-portal.mjs',import.meta.url),'utf8');
const publicEnroll=fs.readFileSync(new URL('../../plugin-server/account-portal/enroll.html',import.meta.url),'utf8');
const login=fs.readFileSync(new URL('../../plugin-server/account-portal/login.html',import.meta.url),'utf8');
const google=fs.readFileSync(new URL('../../plugin-server/google-auth.mjs',import.meta.url),'utf8');

for(const [name,src] of [['executor',executor],['registry',registry]]){
  if(src.includes('wall.dashboard.thaiduy.store/enroll'))throw new Error(`${name}_must_not_use_device_wall_activation_domain`);
  if(!src.includes('https://light-remote.thaiduy.digital/enroll'))throw new Error(`${name}_public_control_plane_activation_missing`);
}
if(!accountPortal.includes("app.get('/enroll'")||!accountPortal.includes("sendPortal(r,'enroll.html')"))throw new Error('public_enroll_route_missing');
if(!accountPortal.includes("enrollmentId:req.body?.enrollmentId"))throw new Error('account_enrollment_id_forwarding_missing');
if(!registry.includes("const enrollmentId = String(input.enrollmentId || '').trim()")||!registry.includes('this.pending.get(enrollmentId)'))throw new Error('enrollment_id_code_pair_guard_missing');
if(!publicEnroll.includes('/account/api?action=enrollment-approve')||!publicEnroll.includes('enrollmentId,code:code.value'))throw new Error('public_enroll_approval_contract_missing');
if(!publicEnroll.includes("/account/login?next=")||!login.includes("qp.get('next')")||!login.includes('location.href=nextPath'))throw new Error('enrollment_login_return_path_missing');
if(!login.includes("/account/google?next=")||!accountPortal.includes('beginGoogleAuth({returnTo:safeReturnTo(req.query?.next)})')||!google.includes("returnTo:String(flow.returnTo||'/account')"))throw new Error('google_enrollment_return_path_missing');

const publicScripts=[...publicEnroll.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(publicScripts.length!==1)throw new Error('public_enrollment_page_script_count');
new Function(publicScripts[0]);
const loginScripts=[...login.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
if(loginScripts.length!==1)throw new Error('account_login_script_count');
new Function(loginScripts[0]);

console.log('enrollment-page-inline-js=PASS');
console.log('enrollment-page-api-contract=PASS');
console.log('gateway-enrollment-auth-split=PASS');
console.log('public-control-plane-enrollment=PASS');
console.log('public-enrollment-id-code-pair=PASS');
console.log('enrollment-login-return-path=PASS');
