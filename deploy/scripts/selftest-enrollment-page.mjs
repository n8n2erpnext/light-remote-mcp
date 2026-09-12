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
console.log('enrollment-page-inline-js=PASS');
console.log('enrollment-page-api-contract=PASS');
console.log('gateway-enrollment-auth-split=PASS');
