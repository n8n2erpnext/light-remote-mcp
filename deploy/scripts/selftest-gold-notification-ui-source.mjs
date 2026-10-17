import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = relative => fs.readFileSync(new URL('../../'+relative,import.meta.url),'utf8');
const html=read('plugin-server/admin-portal/index.html');
const admin=read('plugin-server/admin-portal.mjs');
const account=read('plugin-server/account-portal.mjs');
const runtime=read('operator-host/executor-routes-account.mjs');
const frontend=read('plugin-server/admin-portal/notification-center.js');
for(const id of ['view-notification-center','notificationCompose','notificationStatus','notificationRows','notificationAudience','notificationPublish','notificationConfirm']){
  assert.equal(html.split('id="'+id+'"').length-1,1,'one V4 notification element: '+id);
}
assert(html.includes('data-view="notification-center"'));
assert(html.includes('/admin/assets/notification-center.js'));
for(const route of ['notification-publish','notification-cancel','notifications']){
  assert(admin.includes("action==='"+route+"'"));
  assert(frontend.includes("'"+route+"'"));
}
assert(admin.includes("if(mutations.has(action)&&!sameOrigin(req))"));
assert(admin.includes("const admin=await requireAdmin(req,res)"));
assert(admin.includes('/v1/admin/notifications/publish'));
assert(runtime.includes('/v1/admin/notifications/publish'));
assert(account.includes("team_approval_requires_oauth_plugin"),'browser cannot self-mint team OAuth identity');
assert(account.includes("'/account/inbox'")||account.includes("'/account/inbox','/account/inbox/'"));
assert(account.includes('sendTeamInvitation'));
console.log('GOLD_V4_NOTIFICATION_CENTER_UI_SOURCE_WIRING=PASS');
console.log('GOLD_ADMIN_AUTH_CSRF_AND_TARGET_RESOLUTION_SOURCE_GUARDS=PASS');
console.log('GOLD_TEAM_BROWSER_CANNOT_IMPERSONATE_OAUTH_AGENT_SOURCE_GUARD=PASS');
