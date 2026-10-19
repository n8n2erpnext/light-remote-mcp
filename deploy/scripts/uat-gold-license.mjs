/** Isolated PostgreSQL 17 License UAT. Synthetic account only; no real keys.
 * Usage: GOLD_LICENSE_UAT_STAGE=preflight|write|read|cleanup node <script>
 * Refuses to modify License state if existing non-UAT records are present.
 */
import assert from 'node:assert/strict';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldNativeLicense} from '../../lib/gold-native-license.mjs';

const stage=String(process.env.GOLD_LICENSE_UAT_STAGE||'');
if(!['preflight','write','read','cleanup'].includes(stage))throw Error('gold_license_uat_stage_invalid');
const accountId='acct_gold_license_20261019',licenseId='lic_gold_20261019';
const keyHash='f'.repeat(64),email='gold-license-20261019@example.invalid';
const issuedAt=1792371600000;
const db=await connectGoldStorage();
const count=async(table)=>Number((await db.pool.query('SELECT count(*)::integer AS n FROM '+table)).rows[0].n);
const counts=async()=>({licenses:await count('lr_gold_license_keys'),
  redemptions:await count('lr_gold_license_redemptions'),
  syntheticAccounts:Number((await db.pool.query('SELECT count(*)::integer AS n FROM lr_accounts WHERE account_id=$1',[accountId])).rows[0].n)});
const verify=async()=>{
 const data=await GoldNativeLicense.open({pool:db.pool});
 assert.equal(data.rows.length,1);
 const [id,row]=data.rows[0];
 assert.equal(id,licenseId);assert.equal(row.licenseId,licenseId);
 assert.equal(row.keyHash,keyHash);assert.equal(row.plan,'pro');
 assert.equal(row.durationMs,30*24*60*60*1000);
 assert.equal(row.redemptions.length,1);
 assert.equal(row.redemptions[0].accountId,accountId);
 assert.deepEqual(await counts(),{licenses:1,redemptions:1,syntheticAccounts:1});
};
try{
 const before=await counts();
 if(stage==='preflight'){
  console.log('GOLD_LICENSE_UAT_PREFLIGHT',JSON.stringify(before));
 }else if(stage==='write'){
  assert.deepEqual(before,{licenses:0,redemptions:0,syntheticAccounts:0},'refuse_existing_license_data');
  await db.pool.query('INSERT INTO lr_accounts(account_id,email,plan,status) VALUES($1,$2,$3,$4)',
    [accountId,email,'pro','active']);
  const native=await GoldNativeLicense.open({pool:db.pool});
  await native.store.write(new Map([[licenseId,{
   licenseId,keyHash,last4:'UAT1',plan:'pro',durationMs:30*24*60*60*1000,
   maxRedemptions:1,issuedAt,expiresAt:null,revokedAt:null,revokeReason:null,
   label:'gold isolated relational UAT',redemptions:[{accountId,redeemedAt:issuedAt+1000}]
  }]]));
  await verify();
  console.log('GOLD_LICENSE_REAL_PG17_WRITE_READ=PASS');
 }else if(stage==='read'){
  await verify();
  console.log('GOLD_LICENSE_REAL_PG17_AFTER_RESTART=PASS');
 }else{
  assert.deepEqual(before,{licenses:1,redemptions:1,syntheticAccounts:1},'refuse_unexpected_cleanup_state');
  await verify();
  const native=await GoldNativeLicense.open({pool:db.pool});
  await native.store.write(new Map());
  await db.pool.query('DELETE FROM lr_accounts WHERE account_id=$1',[accountId]);
  assert.deepEqual(await counts(),{licenses:0,redemptions:0,syntheticAccounts:0});
  console.log('GOLD_LICENSE_REAL_PG17_CLEANUP=PASS');
 }
}finally{await db.close()}
