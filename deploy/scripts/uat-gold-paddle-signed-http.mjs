/** Actual signed HTTP route with the real Paddle SDK, isolated UAT fake key only.
 * Gold Plugin systemd service must be STOPPED while this one-off Plugin runs
 * to preserve the single writer contract. No Paddle API/network calls.
 * GOLD_SIGNED_STAGE=write|cleanup. Restart Gold Plugin after each run.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const pluginRequire=createRequire(new URL('../../plugin-server/server.mjs',import.meta.url));
const express=pluginRequire('express');
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {GoldNativePaddle} from '../../lib/gold-native-paddle.mjs';
import {registerPaddleWebhook,paddleBilling} from '../../plugin-server/paddle-billing.mjs';

const stage=process.env.GOLD_SIGNED_STAGE;
assert.ok(stage==='write'||stage==='cleanup','gold_signed_stage_required');
assert.equal(process.env.LR_GOLD_INSTANCE_ID,'uat19','isolated_gold_required');
assert.equal(process.env.LIGHT_REMOTE_PADDLE_ENV,'sandbox');
assert.equal(process.env.LIGHT_REMOTE_PADDLE_CHECKOUT_ENABLED,'false');
const secret=process.env.LIGHT_REMOTE_PADDLE_WEBHOOK_SECRET;
assert.equal(secret,'gold-uat-test-signature-only','only_synthetic_webhook_secret_permitted');
assert.equal(paddleBilling.status().webhookEnabled,true,'paddle_sdk_webhook_must_be_enabled');

const email='gold-native-uat-20261019@example.invalid';
const subscriptionId='sub_gold_signed_http_20261019';
const createdId='evt_gold_signed_http_20261019_created';
const canceledId='evt_gold_signed_http_20261019_canceled';
const gold=await connectGoldStorage();
const pool=gold.pool;
const count=async(table)=>Number((await pool.query('SELECT count(*)::integer AS n FROM '+table)).rows[0].n);
const info=async()=>{
 const rows=await pool.query('SELECT account_id,plan FROM lr_accounts WHERE email=$1',[email]);
 assert.equal(rows.rowCount,1,'synthetic_account_required');
 return rows.rows[0];
};
let server;
try{
 const account=await info();
 assert.equal(account.plan,stage==='write'?'free':'pro');
 assert.equal(await count('lr_gold_paddle_events'),stage==='write'?0:1);
 const store=await GoldRegistryPersistence.open({pool});
 store.mount('paddle_billing',paddleBilling);
 await store.flush();
 const app=express();
 registerPaddleWebhook(app,express.raw({type:'application/json',limit:'512kb'}));
 server=await new Promise((resolve,reject)=>{
   const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.once('error',reject);
 });
 const origin='http://127.0.0.1:'+server.address().port;
 const body=(type,id,status)=>JSON.stringify({
  event_id:id,event_type:type,occurred_at:new Date().toISOString(),
  data:{id:subscriptionId,status,currency_code:'USD',
   billing_cycle:{interval:'month',frequency:1},items:[],
   custom_data:{light_remote_account_id:account.account_id,light_remote_plan:'pro'}}
 });
 async function request(raw,{tamper=false}={}){
  const ts=Math.floor(Date.now()/1000);
  const digest=crypto.createHmac('sha256',secret).update(ts+':'+raw).digest('hex');
  const sig='ts='+ts+';h1='+(tamper?'f'.repeat(64):digest);
  const response=await fetch(origin+'/billing/paddle/webhook',{
   method:'POST',headers:{'content-type':'application/json','paddle-signature':sig},body:raw});
  const value=await response.json();
  return {status:response.status,value};
 }
 if(stage==='write'){
  const raw=body('subscription.created',createdId,'active');
  const bad=await request(raw,{tamper:true});
  assert.equal(bad.status,400,'invalid_signature_must_fail');
  assert.equal((await info()).plan,'free','invalid_signature_modified_account');
  assert.equal(await count('lr_gold_paddle_events'),0,'invalid_signature_committed_event');
  const one=await request(raw);
  assert.equal(one.status,200,JSON.stringify(one));
  assert.equal((await info()).plan,'pro');
  assert.equal(await count('lr_gold_paddle_events'),1);
  const dup=await request(raw);
  assert.equal(dup.status,200,JSON.stringify(dup));
  assert.equal(await count('lr_gold_paddle_events'),1);
  console.log('GOLD_SIGNED_PADDLE_HTTP_REJECT_GRANT_DEDUP=PASS');
 }else{
  const raw=body('subscription.canceled',canceledId,'canceled');
  const cancel=await request(raw);
  assert.equal(cancel.status,200,JSON.stringify(cancel));
  assert.equal((await info()).plan,'free');
  assert.equal(await count('lr_gold_paddle_events'),2);
  const native=await GoldNativePaddle.open({pool});
  assert.deepEqual(Object.keys(native.data.events).sort(),[createdId,canceledId].sort());
  assert.deepEqual(Object.keys(native.data.subscriptions),[subscriptionId]);
  await native.store.write({schemaVersion:2,events:{},subscriptions:{},refunds:{}});
  assert.equal(await count('lr_gold_paddle_events'),0);
  assert.equal(await count('lr_gold_paddle_subscriptions'),0);
  console.log('GOLD_SIGNED_PADDLE_HTTP_REVOKE_CLEANUP=PASS');
 }
}finally{
 if(server) await new Promise(resolve=>server.close(resolve));
 await gold.close();
}
