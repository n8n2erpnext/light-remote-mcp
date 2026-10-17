import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');
const route=fs.readFileSync(path.join(root,'operator-host/executor-routes-account.mjs'),'utf8');
assert.match(source,/const goldAccountAuthMode=String\(process\.env\.LR_GOLD_ACCOUNT_AUTH_PG/);
assert.match(source,/const goldNotificationMode=String\(process\.env\.LR_GOLD_NOTIFICATIONS_PG/);
assert.match(source,/gold_account_auth_requires_notifications_pg/);
assert.match(source,/const goldNotificationPlane=goldNotificationMode/);
assert.match(source,/await openGoldDataPlane\(\)/);
assert.match(source,/createGoldOperatorNotificationBridge\(\{/);
assert.match(source,/socketPath:notificationCoreSocket\(process\.env\)/);
assert.match(source,/accountRoutes:goldAccountAuthMode/);
assert.match(source,/accountProfileRoutes:goldAccountAuthMode/);
assert.match(source,/isUnmigratedGoldAccountAuthorityRoute\(url\.pathname\)/);
assert.match(source,/accountNotifications=goldNotificationBridge/);
assert.match(source,/\?null \/\/ canonical routes are intercepted/);
assert.match(source,/if\(goldNotificationBridge&&await goldNotificationBridge\(req,res,url\)\)return/);
for(const fragment of [
  'await accountNotifications.inbox(','await accountNotifications.markRead(',
  'await accountNotifications.list(','await accountNotifications.publish(',
  'await accountNotifications.cancel('
])assert(route.includes(fragment),'notification route not async: '+fragment);
const p=spawnSync(process.execPath,[path.join(root,'operator-host/executor.mjs')],{
  cwd:root,timeout:3500,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'test',
    LR_GOLD_NOTIFICATIONS_PG:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'0'},
  encoding:'utf8',maxBuffer:4000
});
assert.equal(p.status,1, 'PG mode must fail before server startup, not time out');
assert.match(p.stderr,/gold_data_requires_independent_runtime/);
console.log('GOLD_NOTIFICATION_PG_OPERATOR_CORE_BRIDGE_FAILS_CLOSED_UNCONFIGURED_PASS');
const auth=spawnSync(process.execPath,[path.join(root,'operator-host/executor.mjs')],{
 cwd:root,timeout:3500,env:{PATH:process.env.PATH||'/usr/bin:/bin',
  HOME:'/tmp',NODE_ENV:'test',LR_GOLD_ACCOUNT_AUTH_PG:'1',
  LIGHT_REMOTE_GOLD_INDEPENDENT:'0'},encoding:'utf8',maxBuffer:4000
});
assert.equal(auth.status,1,'Account auth canary must refuse isolated deployment without notifications');
assert.match(auth.stderr,/gold_account_auth_requires_notifications_pg/);
console.log('GOLD_NOTIFICATION_ROUTES_AWAIT_DATABASE_QUERIES_AND_CORE_AUTHORITY_PASS');
console.log('GOLD_ACCOUNT_AUTH_PG_REQUIRES_UNIFIED_NOTIFICATIONS_AUTHORITY_PASS');
