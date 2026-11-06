import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {GoldNativeAccountAux} from '../../lib/gold-native-account-aux.mjs';
const from='acct_source',to='acct_destination';
let current=null,sqlLog=[],revisions=[];
const client={async query(sql,params=[]){
 sqlLog.push(sql);
 if(sql.startsWith('SELECT owner_account_id,revision FROM lr_gold_owner_authority')){
  return {rows:current?[current]:[]};
 }
 if(sql.startsWith('INSERT INTO lr_gold_owner_authority')){
  current={owner_account_id:params[0],revision:0};return {rowCount:1};
 }
 if(sql.startsWith('UPDATE lr_gold_owner_authority')){
  assert.equal(params[2],current.owner_account_id);assert.equal(params[3],current.revision);
  current={owner_account_id:params[0],revision:params[1]};return {rowCount:1};
 }
 if(sql.startsWith('INSERT INTO lr_gold_owner_handoffs')){
  revisions.push(params);return {rowCount:1};
 }
 return {rows:[],rowCount:0};
}};
const aux=new GoldNativeAccountAux({pool:{query:async()=>({rows:[]})},singleOwnerEnabled:true});
const state={accounts:[[from,{accountId:from}],[to,{accountId:to}]],
 ownerAccountId:from,ownerRevision:0,
 sessions:[],oneTimeTokens:[],upgradeRequests:[],pendingRegistrations:[],
 googleSignupIntents:[],groups:[]};
await aux.write(state,client);
assert.deepEqual(current,{owner_account_id:from,revision:0});
await aux.write({...state,ownerAccountId:to,ownerRevision:1},client);
assert.deepEqual(current,{owner_account_id:to,revision:1});
assert.deepEqual(revisions,[[1,from,to]]);
await assert.rejects(aux.write(state,client),/gold_single_owner_stale_write_denied/);
assert.deepEqual(current,{owner_account_id:to,revision:1});
const source=fs.readFileSync(new URL('../../plugin-server/admin-portal.mjs',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../plugin-server/admin-portal/index.html',import.meta.url),'utf8');
assert.match(source,/me\.account\?\.isOwner!==true/);
assert.match(source,/owner_transfer_origin_required/);
assert.match(source,/headers\(admin.token\)/);
assert.match(html,/id="ownerTransferForm"/);
assert.match(html,/id="ownerTransferDeviceAck"/);
for(const match of html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g))
 if(match[1].trim())new vm.Script(match[1],{filename:'owner-admin-inline.js'});
console.log('GOLD_SINGLE_OWNER_NATIVE_PG_CAS_HISTORY_NO_STALE_REWRITE=PASS');
console.log('GOLD_SINGLE_OWNER_ADMIN_PORTAL_SCRIPT_ORIGIN_AND_OAUTH=PASS');
