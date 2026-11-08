/**
 * Real isolated Gold Operator+PostgreSQL+HTTP account UAT for Paddle business events.
 * Synthetic provider events only; NO Paddle network call, billing or live webhook.
 * Stages: preflight -> write -> restart Operator/Plugin -> read -> cleanup -> restart.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {GoldNativePaddle} from '../../lib/gold-native-paddle.mjs';
import {PaddleBilling,EventName} from '../../plugin-server/paddle-billing.mjs';
import {callOperatorJson} from '../../plugin-server/operator-client.mjs';

const stage=process.env.GOLD_PADDLE_FLOW_STAGE;
assert.ok(['preflight','write','read','cleanup'].includes(stage),'explicit_flow_stage_required');
assert.equal(process.env.LR_GOLD_INSTANCE_ID,'uat19','isolated_gold_instance_required');
const origin='http://127.0.0.1:5583';
const cookieFile='/var/lib/light-remote-gold-uat/operator/uat-api-cookie';
const email='gold-native-uat-20261019@example.invalid';
const signed=process.env.GOLD_EXPECT_SIGNED==='1';
const subId=signed?'sub_gold_signed_http_20261019':'sub_gold_uat_flow_20261019';
const createdId=signed?'evt_gold_signed_http_20261019_created':'evt_gold_uat_flow_20261019_created';
const canceledId=signed?'evt_gold_signed_http_20261019_canceled':'evt_gold_uat_flow_20261019_canceled';
const gold=await connectGoldStorage();
const pool=gold.pool;
const n=async(sql,values=[])=>Number((await pool.query(sql,values)).rows[0].n);
async function readMe(){
 const cookie=fs.readFileSync(cookieFile,'utf8').trim();
 const response=await fetch(origin+'/account/api?action=me',{headers:{Cookie:cookie,Origin:origin}});
 const data=await response.json();
 assert.equal(response.status,200,'account_http_read_failed');
 assert.equal(data.account?.email,email);
 return data.account;
}
function createBilling(){
 return new PaddleBilling({
  config:{environment:'production',apiKey:'',clientToken:'',proPriceId:'',webhookSecret:''},
  paddleClient:{},operatorCall:callOperatorJson
 });
}
const event=(id,eventType,accountId,status)=>({eventId:id,eventType,data:{
 id:subId,status,customData:{light_remote_account_id:accountId,light_remote_plan:'pro'}
}});
async function inspect(expectedPlan,expectedEvents){
 const result=await pool.query('SELECT account_id,plan FROM lr_accounts WHERE email=$1',[email]);
 assert.equal(result.rowCount,1,'synthetic_account_missing');
 assert.equal(result.rows[0].plan,expectedPlan,'sql_account_plan_wrong');
 const me=await readMe();
 assert.equal(me.accountId,result.rows[0].account_id);
 assert.equal(me.plan,expectedPlan,'http_account_plan_wrong');
 assert.equal(await n('SELECT count(*)::integer AS n FROM lr_gold_paddle_events'),expectedEvents,'paddle_event_count_wrong');
 const state=await GoldNativePaddle.open({pool});
 if(expectedEvents>=1){
  assert.equal(state.data.events[createdId].eventType,EventName.SubscriptionCreated);
  assert.equal(state.data.subscriptions[subId]?.status,expectedPlan==='pro'?'active':'canceled');
 }
 return result.rows[0].account_id;
}
try{
 if(stage==='preflight'){
  const acc=await inspect('free',0);
  assert.equal(await n('SELECT count(*)::integer AS n FROM lr_gold_paddle_subscriptions'),0);
  assert.equal(await n('SELECT count(*)::integer AS n FROM lr_gold_paddle_refunds'),0);
  console.log('GOLD_PADDLE_FLOW_PREFLIGHT=PASS');
 }else if(stage==='write'){
  const accountId=await inspect('free',0);
  const bill=createBilling(),store=await GoldRegistryPersistence.open({pool});
  store.mount('paddle_billing',bill);await store.flush();
  const result=await bill.processEvent(event(createdId,EventName.SubscriptionCreated,accountId,'active'));
  assert.equal(result.action,'granted',JSON.stringify(result));
  await store.flush();
  await inspect('pro',1);
  const duplicate=await bill.processEvent(event(createdId,EventName.SubscriptionCreated,accountId,'active'));
  assert.equal(duplicate.duplicate,true);
  assert.equal(await n('SELECT count(*)::integer AS n FROM lr_gold_paddle_events'),1);
  console.log('GOLD_PADDLE_FLOW_OPERATOR_PG_HTTP_WRITE=PASS');
 }else if(stage==='read'){
  await inspect('pro',1);
  console.log('GOLD_PADDLE_FLOW_AFTER_SERVICE_RESTART=PASS');
 }else{
  const accountId=await inspect('pro',1);
  const bill=createBilling(),store=await GoldRegistryPersistence.open({pool});
  store.mount('paddle_billing',bill);await store.flush();
  const result=await bill.processEvent(event(canceledId,EventName.SubscriptionCanceled,accountId,'canceled'));
  assert.equal(result.action,'revoked',JSON.stringify(result));
  await store.flush();
  await inspect('free',2);
  const p=await GoldNativePaddle.open({pool});
  assert.deepEqual(Object.keys(p.data.events).sort(),[createdId,canceledId].sort());
  assert.deepEqual(Object.keys(p.data.subscriptions),[subId]);
  await p.store.write({schemaVersion:2,events:{},subscriptions:{},refunds:{}});
  await inspect('free',0);
  console.log('GOLD_PADDLE_FLOW_REVOKE_CLEANUP=PASS');
 }
}finally{await gold.close()}
