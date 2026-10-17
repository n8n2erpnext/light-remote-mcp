import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'../..');
const server=fs.readFileSync(path.join(root,'plugin-server/server.mjs'),'utf8');
const support=fs.readFileSync(path.join(root,'plugin-server/support-backoffice.mjs'),'utf8');

test('Gold Support routes use PostgreSQL outbox, await transaction, reject disabled delivery',()=>{
 assert(server.includes("LR_GOLD_SUPPORT_OUTBOX_PG==='1'"));
 assert(server.includes("new GoldPgSupportOutbox({pool:goldSitePlane.pool,deliveryEnabled:false})"));
 assert(server.includes('resolveIdentity:createGoldSupportAccountResolver({env:process.env})'));
 assert(support.includes('gold_support_postgres_identity_resolver_required'));
 assert(support.includes('gold_support_postgres_outbox_required'));
 assert(support.includes('gold_support_delivery_not_authorized'));
 assert(support.includes('const currentIdentity=req=>resolveIdentity(req,sessionToken(req))'));
 assert(support.includes('identity.goldVerified===true&&identity.supportEligible!==true'));
 assert(server.includes('gold_support_real_erp_delivery_not_authorized'));
 assert(support.includes("await outbox.get(String(req.query?.eventId||''),identity.account.accountId)"));
 assert(support.includes('await outbox.enqueue({account:identity.account,payload})'));
 assert(support.includes("if(process.env.LR_GOLD_SUPPORT_OUTBOX_PG==='1'&&!outbox.deliveryEnabled)"));
 assert(support.includes("error:'support_delivery_not_ready'"));
 assert(server.includes("openGoldDataPlane({role:'plugin'})"));
});
test('Gold Support flag refuses startup without isolated PG credentials before HTTP bind',()=>{
 const result=spawnSync(process.execPath,[path.join(root,'plugin-server/server.mjs')],{
  cwd:path.join(root,'plugin-server'),encoding:'utf8',timeout:3500,maxBuffer:15000,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'test',
   LR_GOLD_SUPPORT_OUTBOX_PG:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}
 });
 assert.equal(result.status,1);
 assert.match(result.stderr,/gold_data_requires_independent_runtime/);
 assert.doesNotMatch(result.stdout,/direct_plugin_listen/);
});
test('Gold Support refuses enabling actual ERPNext sending without separate integration approval',()=>{
 const result=spawnSync(process.execPath,[path.join(root,'plugin-server/server.mjs')],{
  cwd:path.join(root,'plugin-server'),encoding:'utf8',timeout:3500,maxBuffer:15000,
  env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'test',
   LR_GOLD_SUPPORT_OUTBOX_PG:'1',LR_GOLD_SUPPORT_DELIVERY_ENABLED:'1',
   LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}
 });
 assert.equal(result.status,1);
 assert.match(result.stderr,/gold_support_real_erp_delivery_not_authorized/);
 assert.doesNotMatch(result.stdout,/direct_plugin_listen/);
});
