/** Real PostgreSQL 17 Paddle persistence UAT. No Paddle SDK/network calls.
 * Stages: GOLD_PADDLE_UAT_STAGE=preflight|write|read|cleanup.
 * Every mutation requires an initially empty isolated Paddle state or an
 * exact match to the synthetic UAT rows. Never touches live transactions.
 */
import assert from 'node:assert/strict';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldNativePaddle} from '../../lib/gold-native-paddle.mjs';

const stage=String(process.env.GOLD_PADDLE_UAT_STAGE||'');
if(!['preflight','write','read','cleanup'].includes(stage))throw Error('gold_paddle_uat_stage_invalid');
const accountId='acct_gold_paddle_20261019';
const email='gold-paddle-20261019@example.invalid';
const subscriptionId='sub_gold_uat_20261019';
const transactionId='txn_gold_uat_20261019';
const adjustmentId='adj_gold_uat_20261019';
const evtSubscription='evt_gold_uat_20261019_created';
const evtTransaction='evt_gold_uat_20261019_completed';
const issuedMs=1792371600000;
const amount=2000; // minor currency units; synthetic, no payment
const db=await connectGoldStorage();
const pool=db.pool;
const count=async(table)=>Number((await pool.query('SELECT count(*)::integer AS n FROM '+table)).rows[0].n);
const counts=async()=>({
 events:await count('lr_gold_paddle_events'),
 subscriptions:await count('lr_gold_paddle_subscriptions'),
 refunds:await count('lr_gold_paddle_refunds'),
 syntheticAccounts:Number((await pool.query('SELECT count(*)::integer AS n FROM lr_accounts WHERE account_id=$1',[accountId])).rows[0].n)
});
const empty={events:0,subscriptions:0,refunds:0,syntheticAccounts:0};
const expected={events:2,subscriptions:1,refunds:1,syntheticAccounts:1};

async function verify(){
 assert.deepEqual(await counts(),expected,'paddle_uat_counts_mismatch');
 const native=await GoldNativePaddle.open({pool});
 assert.deepEqual(Object.keys(native.data.events).sort(),[evtSubscription,evtTransaction].sort());
 assert.equal(native.data.events[evtSubscription].eventType,'subscription.created');
 assert.equal(native.data.events[evtTransaction].eventType,'transaction.completed');
 assert.equal(native.data.events[evtTransaction].result.transactionId,transactionId);
 assert.equal(native.data.events[evtTransaction].result.currency,'USD');
 assert.equal(native.data.events[evtTransaction].result.amountMinor,amount);
 assert.deepEqual(Object.keys(native.data.subscriptions),[subscriptionId]);
 assert.equal(native.data.subscriptions[subscriptionId].accountId,accountId);
 assert.equal(native.data.subscriptions[subscriptionId].status,'active');
 assert.equal(native.data.refunds[adjustmentId].transactionId,transactionId);
 assert.equal(native.data.refunds[adjustmentId].subscriptionId,subscriptionId);
 assert.equal(native.data.refunds[adjustmentId].status,'pending');
 assert.equal(native.data.refunds[adjustmentId].result.provider,'synthetic-uat');
 // Only provider-result objects may use JSONB. Core identities/statuses are columns.
 const row=await pool.query(`SELECT
  (SELECT jsonb_typeof(result) FROM lr_gold_paddle_events WHERE event_id=$1) AS event_result_type,
  (SELECT jsonb_typeof(result) FROM lr_gold_paddle_refunds WHERE adjustment_id=$2) AS refund_result_type,
  (SELECT status FROM lr_gold_paddle_subscriptions WHERE subscription_id=$3) AS subscription_status`,
  [evtTransaction,adjustmentId,subscriptionId]);
 assert.equal(row.rows[0].event_result_type,'object');
 assert.equal(row.rows[0].refund_result_type,'object');
 assert.equal(row.rows[0].subscription_status,'active');
}
try{
 const before=await counts();
 if(stage==='preflight'){
  console.log('GOLD_PADDLE_UAT_PREFLIGHT',JSON.stringify(before));
 }else if(stage==='write'){
  assert.deepEqual(before,empty,'refuse_preexisting_paddle_state');
  await pool.query('INSERT INTO lr_accounts(account_id,email,plan,status) VALUES($1,$2,$3,$4)',
    [accountId,email,'pro','active']);
  const native=await GoldNativePaddle.open({pool});
  await native.store.write({
   schemaVersion:2,
   events:{
    [evtSubscription]:{eventType:'subscription.created',processedAt:issuedMs,result:{subscriptionId,status:'active'}},
    [evtTransaction]:{eventType:'transaction.completed',processedAt:issuedMs+1000,
      result:{transactionId,subscriptionId,currency:'USD',amountMinor:amount,provider:'synthetic-uat'}}
   },
   subscriptions:{
    [subscriptionId]:{accountId,status:'active',eventType:'subscription.created',updatedAt:issuedMs}
   },
   refunds:{
    [adjustmentId]:{transactionId,accountId,subscriptionId,status:'pending',requestedBy:'uat',reason:'synthetic test',requestedAt:issuedMs+2000,updatedAt:issuedMs+2000,result:{provider:'synthetic-uat',status:'pending'}}
   }
  });
  await verify();
  console.log('GOLD_PADDLE_REAL_PG17_WRITE_READ=PASS');
 }else if(stage==='read'){
  await verify();
  console.log('GOLD_PADDLE_REAL_PG17_AFTER_RESTART=PASS');
 }else{
  assert.deepEqual(before,expected,'refuse_unexpected_paddle_cleanup_state');
  await verify();
  const native=await GoldNativePaddle.open({pool});
  await native.store.write({schemaVersion:2,events:{},subscriptions:{},refunds:{}});
  await pool.query('DELETE FROM lr_accounts WHERE account_id=$1',[accountId]);
  assert.deepEqual(await counts(),empty,'cleanup_incomplete');
  console.log('GOLD_PADDLE_REAL_PG17_CLEANUP=PASS');
 }
}finally{await db.close()}
