import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {reconcileGoldOwnerDeviceShortIds,ensureGoldDeviceShortId,SHORT_ID_RE,
 listOwnerShortIdDevices} from '../../lib/gold-device-short-id.mjs';
const here=new URL('../../',import.meta.url);
const source=rel=>fs.readFileSync(fileURLToPath(new URL(rel,here)),'utf8');
const operator=source('operator-host/executor.mjs');
const account=source('operator-host/executor-routes-account.mjs');
const channel=source('operator-host/executor-routes-device-channel.mjs');
assert.match(operator,/goldStorage\.schema\?\.version>=43/);
assert.match(operator,/LR_GOLD_AB_V2_HELPER_TARGET_QUERY==='1'/);
assert.match(operator,/await goldRegistries\.flush\(\);\s*return ensureGoldDeviceShortId/);
assert.match(operator,/reconcileGoldOwnerDeviceShortIds\(goldStorage\.pool/);
assert.match(account,/await goldShortIdAfterEnrollment\(device\.deviceId\)/);
assert.match(channel,/await goldShortIdAfterEnrollment\(device\.deviceId\)/);
assert.ok(account.indexOf('devices.enroll(')<account.indexOf('await goldShortIdAfterEnrollment(device.deviceId)'));
assert.ok(channel.indexOf('devices.enroll(')<channel.indexOf('await goldShortIdAfterEnrollment(device.deviceId)'));
const devices=new Map([
 ['new-owner-device',{deviceId:'new-owner-device',accountId:'acct_new',state:'online',name:'Linux Lab'}],
 ['legacy-owner-device',{deviceId:'legacy-owner-device',accountId:'acct_old',state:'online',name:'Old Linux'}],
 ['revoked-device',{deviceId:'revoked-device',accountId:'acct_new',state:'revoked',name:'Revoked'}]
]);
const shorts=new Map([['OLD1AB','legacy-owner-device']]);
const deviceShort=new Map([['legacy-owner-device','OLD1AB']]);
let generated=0;
const pool={async query(sql,args=[]){
 if(sql.includes('d.owner_account_id=ANY($1::text[])')){
  const ids=new Set(args[0]);
  const rows=[...devices.values()].filter(d=>ids.has(d.accountId)&&
   d.state!=='revoked'&&!deviceShort.has(d.deviceId)).slice(0,args[1])
   .map(d=>({device_id:d.deviceId}));
  return {rows,rowCount:rows.length};
 }
 if(sql.startsWith('SELECT short_id FROM lr_gold_device_short_ids')){
  const id=deviceShort.get(args[0]);return {rows:id?[{short_id:id}]:[]};
 }
 if(sql.includes('INSERT INTO lr_gold_device_short_ids')){
  const [sid,did]=args,device=devices.get(did);
  if(device?.state==='revoked'||!device||shorts.has(sid)||deviceShort.has(did))
   return {rows:[]};
  shorts.set(sid,did);deviceShort.set(did,sid);
  return {rows:[{short_id:sid}]};
 }
 if(sql.includes("SELECT 1 FROM lr_devices WHERE")){
  const d=devices.get(args[0]);
  return {rows:d&&d.state!=='revoked'?[{a:1}]:[]};
 }
 if(sql.includes('FROM lr_devices d INNER JOIN lr_gold_device_short_ids')){
  const ids=[...devices.values()].filter(x=>x.accountId===args[0]&&
   x.state!=='revoked'&&deviceShort.has(x.deviceId)).slice(0,args[1]);
  return {rows:ids.map(d=>({device_id:d.deviceId,node_id:d.deviceId,
    display_name:d.name,platform:'linux',state:d.state,
    short_id:deviceShort.get(d.deviceId)}))};
 }
 throw Error('unexpected_SQL:'+sql.slice(0,120));
}};
const deterministic=(max)=>++generated%max;
assert.deepEqual(await reconcileGoldOwnerDeviceShortIds(pool,{
 accountIds:['acct_new'],maxDevices:10}),{created:1,moreMayRemain:false});
const shortId=deviceShort.get('new-owner-device');
assert.match(shortId,SHORT_ID_RE);
assert.notEqual(shortId,'OLD1AB');
assert.equal(await ensureGoldDeviceShortId(pool,{deviceId:'new-owner-device'}),shortId);
assert.deepEqual(await reconcileGoldOwnerDeviceShortIds(pool,{
 accountIds:['acct_new'],maxDevices:10}),{created:0,moreMayRemain:false});
assert.equal(deviceShort.has('revoked-device'),false);
assert.equal(deviceShort.get('legacy-owner-device'),'OLD1AB');
const visible=await listOwnerShortIdDevices(pool,{accountId:'acct_new'});
assert.deepEqual(visible.map(d=>d.deviceId),['new-owner-device']);
const oldVisible=await listOwnerShortIdDevices(pool,{accountId:'acct_old'});
assert.deepEqual(oldVisible.map(d=>d.deviceId),['legacy-owner-device']);
await assert.rejects(()=>reconcileGoldOwnerDeviceShortIds(pool,{accountIds:[]}),
 /gold_short_id_reconcile_scope_invalid/);
await assert.rejects(()=>ensureGoldDeviceShortId(pool,{deviceId:'revoked-device',randomInt:deterministic}),
 /gold_short_id_device_unavailable/);
console.log('ABV2_SHORT_ID_NEW_OWNER_LIFECYCLE_HOOK_BOTH_ROUTES=PASS');
console.log('ABV2_SHORT_ID_OWNER_SCOPED_RESTART_RECOVERY_AND_IDEMPOTENCE=PASS');
console.log('ABV2_SHORT_ID_REVOKED_EXCLUSION_AND_OLD_OWNER_NONREUSE=PASS');
