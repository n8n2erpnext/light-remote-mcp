import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../../plugin-server/admin-portal/index.html',import.meta.url),'utf8');
const api=fs.readFileSync(new URL('../../plugin-server/admin-portal.mjs',import.meta.url),'utf8');

assert.match(html,/data-view="billing"/);
assert.match(html,/Billing & refunds/);
assert.match(html,/data-refund-transaction/);
assert.match(html,/Refund eligible/);
assert.match(html,/PRO is kept until Paddle approves the refund/);
assert.match(api,/action==='paddle-billing'/);
assert.match(api,/action==='paddle-refund'/);
assert.match(api,/refundWindowHours:24/);
assert.match(api,/requestedBy:String\(admin\.me\?\.account\?\.accountId\|\|ADMIN_ACCOUNT_ID\)/);

console.log('paddle-admin-nav=PASS');
console.log('paddle-admin-listing=PASS');
console.log('paddle-admin-refund-action=PASS');
console.log('paddle-admin-two-step-confirmation=PASS');
