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
const usage=read('plugin-server/account-portal/usage.html');
const theme=read('plugin-server/account-portal/theme.js');
const css=read('plugin-server/account-portal/portal.css');
const distribution=read('plugin-server/distribution-portal.mjs');
const downloadsPortal=read('plugin-server/downloads-portal.html');
const publicHome=read('plugin-server/public-home.html');
const legalPages=read('plugin-server/legal-pages.mjs');
const supportPage=read('plugin-server/support-page.mjs');
const webAssets=read('plugin-server/web-assets.mjs');
const admin=read('plugin-server/admin-portal.mjs');
const adminHtml=read('plugin-server/admin-portal/index.html');
const server=read('plugin-server/server.mjs');
const directOperatorUnit=read('deploy/direct-linux/light-remote-direct-operator.service');
const directPluginUnit=read('deploy/direct-linux/light-remote-direct-plugin.service');

for(const [name,unit] of [['operator',directOperatorUnit],['plugin',directPluginUnit]]){
  assert.ok(unit.includes('UnsetEnvironment=LIGHT_REMOTE_VERSION OPERATOR_VERSION'),`direct_${name}_must_follow_current_release_version`);
}

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
for(const page of [devices,usage,billing,settings])assert.ok(page.includes('href="/support"'),'account portal support link missing');

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
assert.ok(distribution.includes("downloads-portal.html"),'downloads portal must be isolated from distribution routing');
assert.ok(distribution.includes("releaseAssets(release)"),'nested release assets must be downloadable through the R2 redirect lane');
assert.ok(distribution.includes("base!==name"),'distribution path traversal guard');
for(const os of ['linux','windows','macos','ios','android','docker'])assert.ok(downloadsPortal.includes('data-os="'+os+'"'),`downloads tab missing:${os}`);
for(const icon of ['linux.svg','windows.svg','apple.svg','ios.svg','android.svg','docker.svg','github.svg'])assert.ok(downloadsPortal.includes('/assets/icons/platform/'+icon),`downloads icon missing:${icon}`);
assert.ok(downloadsPortal.includes('Install with Command-line')&&downloadsPortal.includes('light-remote up'),'Linux NetBird-style step flow missing');
assert.ok(downloadsPortal.includes('Unsigned / Not notarized prerelease'),'macOS unsigned warning missing');
assert.ok(downloadsPortal.includes('<details class="download-secondary">'),'secondary download tier missing');
assert.ok(downloadsPortal.includes('Download from GitHub Release'),'GitHub fallback tier missing');
assert.ok(downloadsPortal.includes("['linux','linux-desktop','linux-server']"),'legacy Linux download hash compatibility missing');
assert.ok(webAssets.includes("/assets/icons/platform/:name"),'platform icon web route missing');
assert.ok(webAssets.includes("/assets/brand/:name"),'brand asset web route missing');
assert.ok(downloadsPortal.includes('rel="icon" href="/account/assets/light-remote.ico"'),'downloads favicon missing');
assert.ok(downloadsPortal.includes('rel="canonical" href="https://light-remote.thaiduy.digital/downloads"'),'downloads canonical missing');
assert.ok(downloadsPortal.includes('application/ld+json'),'downloads structured data missing');
assert.ok(downloadsPortal.includes('https://lightbi.app/')&&downloadsPortal.includes('https://thaiduy.digital/'),'downloads ecosystem backlinks missing');
assert.ok(downloadsPortal.includes("expand:'/assets/icons/material/expand_more.svg'")&&!downloadsPortal.includes('⌄'),'downloads accordion must use Material expand_more asset');
assert.ok(publicHome.includes('rel="canonical" href="https://light-remote.thaiduy.digital/"'),'home canonical missing');
assert.ok(publicHome.includes('application/ld+json')&&publicHome.includes('SoftwareApplication'),'home structured data missing');
assert.ok(publicHome.includes('https://lightbi.app/')&&publicHome.includes('https://thaiduy.digital/'),'home ecosystem backlinks missing');
assert.ok(publicHome.includes('LIGHT REMOTE MCP · RC.33'),'home release label stale');
for(const phrase of ['Terms of Service','Privacy Policy','Cookie Policy','Local Wall','A/B approval','Remote task data','__Host-light_remote_account'])assert.ok(legalPages.includes(phrase),`legal content missing:${phrase}`);
assert.ok(server.includes("app.get('/cookies'")&&server.includes("'/cookies'"),'cookie policy route/indexing missing');
assert.ok(server.includes("const urls=['/','/downloads','/support','/privacy','/terms','/cookies']"),'cookie policy sitemap missing');
for(const phrase of ['What are you trying to fix?','Getting started','Connection & A/B approval','Real Remote','Account & plans','Troubleshooting by symptom','Diagnostics & contact','FAQPage','Copy support template','tool_call_quota_exceeded'])assert.ok(supportPage.includes(phrase),`support center missing:${phrase}`);
for(const secret of ['A/B continuation','bearer tokens','private keys','device secrets'])assert.ok(supportPage.includes(secret),`support redaction guard missing:${secret}`);
assert.ok(supportPage.includes("fetch('/healthz',{cache:'no-store'})"),'safe support diagnostics must use public health only');
assert.ok(server.includes("renderSupportPage({origin:PUBLIC_ORIGIN,version:VERSION})"),'dedicated support renderer missing');
const linuxBootstrap=read('plugin-server/downloads-install-linux.sh');
assert.ok(linuxBootstrap.includes('linux-server')&&linuxBootstrap.includes('--verify-only'));
assert.ok(linuxBootstrap.includes('--defer-enrollment'),'public Linux bootstrap must defer enrollment like NetBird install/up flow');
assert.ok(linuxBootstrap.includes('sha256sum')&&linuxBootstrap.includes('LIGHT_REMOTE_DOWNLOAD_MANIFEST'));
const r2Sync=read('deploy/distribution/sync-release-to-r2.sh');
assert.ok(r2Sync.includes('light-remote/release')&&r2Sync.includes('R2_PUBLIC_URL')&&r2Sync.includes('--aws-sigv4'));
assert.ok(r2Sync.includes("'githubUrl':f'https://github.com/{repo}/releases/download/v{version}/{name}'"),'per-asset GitHub fallback URL missing');
assert.ok(r2Sync.includes("mac_x64=info(f'Light-Remote-{version}-x86_64.pkg')")&&r2Sync.includes("mac_arm64=info(f'Light-Remote-{version}-arm64.pkg')"),'macOS pkg assets missing from distribution manifest');
assert.ok(r2Sync.includes("'available':bool(mac_x64 or mac_arm64)")&&r2Sync.includes("'warning':'Unsigned / Not notarized'"),'macOS unsigned prerelease publication contract missing');
assert.ok(r2Sync.includes("! -name manifest.json -delete"),'large distribution binaries must leave production LXD after R2 publish');
const inlineDownloadScripts=[...downloadsPortal.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
assert.equal(inlineDownloadScripts.length,1,'downloads portal inline script count');
new Function(inlineDownloadScripts[0]);
for(const icon of ['linux.svg','windows.svg','apple.svg','ios.svg','android.svg','docker.svg','github.svg'])assert.ok(fs.existsSync(path.join(root,'assets/icons/platform',icon)),`vendored platform icon missing:${icon}`);

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
assert.ok(server.includes("PUBLIC_INDEXABLE_PATHS")&&server.includes("if(!indexable)res.set('X-Robots-Tag','noindex, nofollow, noarchive')"),'public/private robots header split missing');
assert.ok(server.includes("app.get('/robots.txt'")&&server.includes("app.get('/sitemap.xml'")&&server.includes("app.get('/favicon.ico'"),'SEO discovery routes missing');
assert.ok(server.includes("strict-origin-when-cross-origin")&&server.includes("no-referrer"),'public/private referrer policy split missing');

console.log('direct_free_10k_quota=PASS');
console.log('direct_password_change=PASS');
console.log('direct_dark_light=PASS');
console.log('direct_plan_billing=PASS');
console.log('direct_add_device_wizard=PASS');
console.log('direct_distribution_portal=PASS');
console.log('direct_admin_portal=PASS');
