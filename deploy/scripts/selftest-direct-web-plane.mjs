import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const executor=read('operator-host/executor.mjs');
const runtime=read('operator-host/executor-routes-runtime.mjs');
const accountRoutes=read('operator-host/executor-routes-account.mjs');
const accountPortal=read('plugin-server/account-portal.mjs');
const devices=read('plugin-server/account-portal/index.html');
const settings=read('plugin-server/account-portal/settings.html');
const billing=read('plugin-server/account-portal/billing.html');
const theme=read('plugin-server/account-portal/theme.js');
const css=read('plugin-server/account-portal/portal.css');
const distribution=read('plugin-server/distribution-portal.mjs');
const admin=read('plugin-server/admin-portal.mjs');
const adminHtml=read('plugin-server/admin-portal/index.html');
const server=read('plugin-server/server.mjs');

assert.ok(executor.includes("free:{fleetWall:false,multiDeviceConsole:false,toolCallLimit:10_000}"));
assert.ok(executor.includes("pro:{fleetWall:true,multiDeviceConsole:true,toolCallLimit:null}"));
assert.ok(executor.includes("vip:{fleetWall:true,multiDeviceConsole:true,toolCallLimit:null}"));
assert.ok(executor.includes("new AccountError('tool_call_quota_exceeded',429)"));
assert.ok(executor.includes("assertToolCallQuota(job.accountId);jobs.set(job.id,job)"),'quota must preflight before native job insertion');
assert.ok(runtime.includes("assertToolCallQuota(session.accountId)"),'read/recovery operations must honor quota');
assert.ok(runtime.includes("sessions.record(job.sessionId, 'toolCalls')"),'job/output reads remain metered');

assert.ok(accountRoutes.includes("url.pathname === '/v1/accounts/password'"));
assert.ok(accountRoutes.includes("verifyCredentials({email:identity.account.email,password:currentPassword}"));
assert.ok(accountRoutes.includes("invalidateSessions:true"));
assert.ok(accountPortal.includes("action==='password-change'"));
assert.ok(settings.includes('Change password'));
assert.ok(settings.includes('Current password'));
assert.ok(settings.includes('Dark')&&settings.includes('Light'));
assert.ok(theme.includes("light-remote-theme"));
assert.ok(css.includes('html[data-theme="light"]'));

assert.ok(billing.includes('Plan & billing'));
assert.ok(billing.includes('10,000 tool calls per month'));
assert.ok(billing.includes('Unlimited tool calls'));
assert.ok(billing.includes('$20'));
assert.ok(billing.includes('usage-progress'));

for(const phrase of ['Install client','Get code','Verify','Link device','Re-enroll device','ChatGPT access still requires its separate Local Wall A/B approval'])assert.ok(devices.includes(phrase),phrase);
assert.ok(devices.includes('/downloads#windows'));
assert.ok(devices.includes('/downloads#macos'));
assert.ok(devices.includes('/downloads#linux-desktop'));
assert.ok(devices.includes('/downloads#linux-server'));

assert.ok(distribution.includes("LIGHT_REMOTE_DISTRIBUTION_DIR"));
assert.ok(distribution.includes("app.get(['/downloads','/downloads/']"));
assert.ok(distribution.includes("app.get('/downloads/files/:name'"));
assert.ok(distribution.includes("app.get('/downloads/install.sh'"));
assert.ok(distribution.includes("manifest().installScriptUrl"),'R2-backed install script redirect missing');
assert.ok(distribution.includes("if(row.url)return res.redirect(302,row.url)"),'R2-backed distribution redirect missing');
assert.ok(distribution.includes("x.installCommand?"),'Linux one-line install command missing');
assert.ok(distribution.includes("release=m.releases.find"));
assert.ok(distribution.includes("base!==name"),'distribution path traversal guard');
const linuxBootstrap=read('plugin-server/downloads-install-linux.sh');
assert.ok(linuxBootstrap.includes('linux-server')&&linuxBootstrap.includes('--verify-only'));
assert.ok(linuxBootstrap.includes('sha256sum')&&linuxBootstrap.includes('LIGHT_REMOTE_DOWNLOAD_MANIFEST'));
const r2Sync=read('deploy/distribution/sync-release-to-r2.sh');
assert.ok(r2Sync.includes('light-remote/release')&&r2Sync.includes('R2_PUBLIC_URL')&&r2Sync.includes('--aws-sigv4'));
assert.ok(r2Sync.includes("! -name manifest.json -delete"),'large distribution binaries must leave production LXD after R2 publish');

assert.ok(accountRoutes.includes("url.pathname === '/v1/admin/overview'"));
assert.ok(accountRoutes.includes("url.pathname === '/v1/admin/accounts'"));
assert.ok(admin.includes("ADMIN_ACCOUNT_ID"));
assert.ok(admin.includes("admin_account_required"));
assert.ok(admin.includes("cross_site_request_denied"));
assert.ok(adminHtml.includes('Overview')&&adminHtml.includes('Accounts')&&adminHtml.includes('Licenses'));
assert.ok(adminHtml.includes('data-view="accounts"'));
assert.ok(adminHtml.includes("action='+encodeURIComponent(action)"));

assert.ok(server.includes("registerDistributionPortal(app)"));
assert.ok(server.includes("registerAdminPortal(app)"));

console.log('direct_free_10k_quota=PASS');
console.log('direct_password_change=PASS');
console.log('direct_dark_light=PASS');
console.log('direct_plan_billing=PASS');
console.log('direct_add_device_wizard=PASS');
console.log('direct_distribution_portal=PASS');
console.log('direct_admin_portal=PASS');
