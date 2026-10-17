import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const server=fs.readFileSync(path.join(root,'plugin-server/server.mjs'),'utf8');
const site=fs.readFileSync(path.join(root,'plugin-server/site-announcements.mjs'),'utf8');
const admin=fs.readFileSync(path.join(root,'plugin-server/admin-portal.mjs'),'utf8');
test('Site announcements use the Gold DB when flag enabled, no legacy file on gold',()=>{
 assert.match(site,/if\(!goldPgMode\)\{\s*try\{const data=JSON\.parse\(fs\.readFileSync/);
 assert.match(site,/if\(goldPgMode\)throw Error\('gold_site_json_file_fallback_forbidden'\)/);
 assert.match(site,/if\(goldPgMode\)return goldStore\(\)\.list\(\)/);
 assert.match(site,/if\(goldPgMode\)return goldStore\(\)\.mutate\(method,id,payload\)/);
 assert.match(server,/openGoldDataPlane\(\{role:'plugin'\}\)/);
 assert.match(server,/GoldPgSiteAnnouncementsRepository\(\{pool:goldSitePlane\.pool\}\)/);
 assert.match(site,/try\{notice=await announcementHtml\(req\.path\)\}catch\(error\)\{return next\(error\)\}/);
 assert.match(site,/const feed=await clientAnnouncementFeed/);
 for(const op of ['listAnnouncements()',
  "mutateAnnouncement('POST'","mutateAnnouncement('PUT'","mutateAnnouncement('DELETE'"]){
  assert(admin.includes('await '+op),'Admin API missing await for '+op);
 }
});
test('Plugin fails closed before binding when Gold site is enabled without independent DB credentials',()=>{
 const processResult=spawnSync(process.execPath,[path.join(root,'plugin-server/server.mjs')],{
  cwd:path.join(root,'plugin-server'),
  timeout:3500,encoding:'utf8',maxBuffer:10000,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'test',
    LR_GOLD_SITE_ANNOUNCEMENTS_PG:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}
 });
 assert.equal(processResult.status,1,'plugin must exit before listening');
 assert.match(processResult.stderr,/gold_data_requires_independent_runtime/);
 assert.doesNotMatch(processResult.stdout,/direct_plugin_listen/);
});
