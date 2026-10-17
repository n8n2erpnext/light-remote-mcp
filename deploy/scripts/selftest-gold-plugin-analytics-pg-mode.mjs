import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const server=fs.readFileSync(path.join(root,'plugin-server/server.mjs'),'utf8');
const analytics=fs.readFileSync(path.join(root,'plugin-server/site-analytics.mjs'),'utf8');
const admin=fs.readFileSync(path.join(root,'plugin-server/admin-portal.mjs'),'utf8');
test('Plugin Gold analytics routes use a shared PG connection and never write JSON',()=>{
 assert.match(server,/LR_GOLD_SITE_ANALYTICS_PG==='1'/);
 assert.match(server,/openGoldDataPlane\(\{role:'plugin'\}\)/);
 assert.match(server,/configureGoldPgSiteAnalytics/);
 assert.match(server,/GoldPgSiteAnalyticsRepository\(\{pool:goldSitePlane\.pool\}\)/);
 assert.match(analytics,/if\(!goldPgMode\)\{try\{const state=JSON\.parse\(fs\.readFileSync/);
 assert.match(analytics,/if\(goldPgMode\)throw Error\('gold_site_analytics_json_fallback_forbidden'\)/);
 assert.match(analytics,/if\(goldPgMode\)return saveGoldEvent\(type,attrs\)/);
 assert.match(analytics,/if\(goldPgMode\)return goldStore\(\)\.summary\(daysBack\)/);
 assert.match(analytics,/await record\('download-click'/);
 assert.match(analytics,/await record\('tab'/);
 assert.match(admin,/await siteAnalyticsSummary\(req\.query\?\.days\|\|30\)/);
 assert.match(server,/await flushSiteAnalytics\(\);await goldSitePlane\?\.close\(\)/);
});
test('Plugin refuses to bind port if Analytics PG flag lacks isolated database credentials',()=>{
 const p=spawnSync(process.execPath,[path.join(root,'plugin-server/server.mjs')],{
  cwd:path.join(root,'plugin-server'),timeout:3500,encoding:'utf8',maxBuffer:10000,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'test',
    LR_GOLD_SITE_ANALYTICS_PG:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}
 });
 assert.equal(p.status,1);
 assert.match(p.stderr,/gold_data_requires_independent_runtime/);
 assert.doesNotMatch(p.stdout,/direct_plugin_listen/);
});
