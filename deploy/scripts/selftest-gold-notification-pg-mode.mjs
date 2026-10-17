import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'operator-host/executor.mjs'),'utf8');
const route=fs.readFileSync(path.join(root,'operator-host/executor-routes-account.mjs'),'utf8');
assert.match(source,/const goldNotificationPlane=.*LR_GOLD_NOTIFICATIONS_PG/);
assert.match(source,/await openGoldDataPlane\(\)/);
assert.match(source,/new GoldPgNotificationRepository\(\{pool:goldNotificationPlane\.pool\}\)/);
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
console.log('GOLD_NOTIFICATION_PG_OPTOIN_FAILS_CLOSED_UNCONFIGURED_PASS');
console.log('GOLD_NOTIFICATION_ROUTES_AWAIT_DATABASE_QUERIES_PASS');
