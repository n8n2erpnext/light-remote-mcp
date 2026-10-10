import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PaddleBilling,EventName } from '../../plugin-server/paddle-billing.mjs';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-team-paddle-'));
const id=n=>'pri_'+n.repeat(26),subscriptionId='sub_'+'z'.repeat(26),
 transactionId='txn_'+'t'.repeat(26),now=Date.UTC(2026,9,10);
let owner={accountId:'owner',email:'owner@example.test',plan:'free',entitlement:{source:'default',sourceRef:null}};
let grant=null,txn=null,sub=null;
let subscriptionCanceled=false,customer=null;
const purchases=[],refunds=[],mails=[],operations=[];
const config={environment:'sandbox',checkoutAllowed:true,
 apiKey:'pdl_sdbx_apikey_test',clientToken:'test_token',
 proPriceId:id('a'),proMonthlyPriceId:id('a'),
 proYearlyPriceId:id('b'),teamMonthlyPriceId:id('c'),teamYearlyPriceId:id('d'),
 teamSandboxEnabled:true,teamUatCallBudget:5000,webhookSecret:'test_secret',
 stateFile:path.join(tmp,'billing.json')};
const fake={
 prices:{
   get:async priceId=>{
     const periods=new Map([[id('a'),['20','month']],[id('b'),['200','year']],
       [id('c'),['55','month']],[id('d'),['550','year']]]);
     const row=periods.get(priceId);
     return {id:priceId,status:'active',unitPrice:{amount:String(Number(row?.[0]||0)*100),currencyCode:'USD'},
       billingCycle:{interval:row?.[1]||'month',frequency:1}};
   }
 },
 customers:{
   list:()=>({next:async()=>customer?[customer]:[]}),
   create:async({email})=>{customer={id:'ctm_demo',email};return customer}
 },
 transactions:{
   create:async body=>{operations.push({type:'checkout',body});
    return {id:transactionId,checkout:{url:'https://sandbox.example/test'}}},
   get:async()=>structuredClone(txn),
   list:()=>({next:async()=>txn?[structuredClone(txn)]:[]})
 },
 subscriptions:{
   get:async()=>structuredClone(sub),
   cancel:async()=>{subscriptionCanceled=true;sub.status='canceled';return structuredClone(sub)}
 },
 webhooks:{unmarshal:async()=>{throw Error('unmarshal_not_used')}}
};
const operatorCall=async(method,url,body={})=>{
 operations.push({type:'operator',method,url,body});
 if(method==='GET'&&url==='/v1/admin/accounts/owner')return {account:structuredClone(owner)};
 if(method==='POST'&&url==='/v1/admin/accounts/owner/entitlement'){
   owner.plan=body.plan;owner.entitlement={source:body.source,sourceRef:body.sourceRef};
   return {account:structuredClone(owner)};
 }
 if(method==='POST'&&url==='/v1/admin/accounts/owner/entitlement/revoke'){
   if(owner.entitlement.source==='paddle'){
     owner.plan='free';owner.entitlement={source:'paddle_revoke',sourceRef:null};
   }
   return {account:structuredClone(owner)};
 }
 if(method==='POST'&&url==='/v1/admin/accounts/owner/team-entitlement'){
   grant={active:true,source:body.source,validUntil:body.validUntil,budget:body.monthlyMemberCallBudget};
   return {grant};
 }
 if(method==='DELETE'&&url==='/v1/admin/accounts/owner/team-entitlement'){
   const revoked=grant?.source===body.expectedSource;
   if(revoked)grant=null;
   return {revoked};
 }
 throw Error('unexpected_operator_call '+method+':'+url);
};
const billing=new PaddleBilling({config,paddleClient:fake,operatorCall,now:()=>now,
  purchaseRecorder:async row=>{purchases.push(row);return {event_id:row.event_id,status:'accepted'}},
  refundRecorder:async row=>{refunds.push(row);return {event_id:row.event_id,status:'accepted'}},
  purchaseMailer:async row=>{mails.push(row);return {sent:true}}
});
try{
 assert.equal(billing.publicConfig().sandboxTeamEnabled,true);
 assert.equal(Object.keys(billing.publicConfig().sandboxOffers).length,4);
 assert.equal(billing.publicConfig().sandboxOffers['pro_team:yearly'].amountUSD,550);
 const originalPricesGet=fake.prices.get;
 fake.prices.get=async priceId=>({...await originalPricesGet(priceId),
   unitPrice:{amount:'500',currencyCode:'USD'}});
 await assert.rejects(()=>billing.createSandboxOfferCheckout(owner,{
   product:'pro_team',period:'monthly'}),/price_amount_cycle_mismatch/);
 assert.equal(operations.filter(x=>x.type==='checkout').length,0,
   'mispriced Paddle ID cannot create a checkout');
 fake.prices.get=originalPricesGet;
 const checkout=await billing.createSandboxOfferCheckout(owner,{product:'pro_team',period:'monthly'});
 assert.equal(checkout.product,'pro_team');
 assert.equal(operations[0].body.items[0].priceId,id('c'));
 assert.equal(operations[0].body.customData.light_remote_account_id,'owner');
 assert.equal(operations[0].body.customData.light_remote_plan,'pro_team');
 sub={id:subscriptionId,status:'active',items:[{price:{id:id('c')}}],
   nextBilledAt:'2026-11-10T00:00:00.000Z',billingCycle:{interval:'month',frequency:1},
   customData:{light_remote_account_id:'owner',light_remote_plan:'pro'}};
 txn={id:transactionId,status:'completed',subscriptionId,
   customData:{light_remote_account_id:'owner',light_remote_account_email:'owner@example.test',light_remote_plan:'pro'},
   items:[{price:{id:id('c'),billingCycle:{interval:'month',frequency:1}}}],
   payments:[{status:'captured',capturedAt:new Date(now).toISOString()}],
   details:{totals:{subtotal:'5500',grandTotal:'5500',tax:'0'},payoutTotals:{fee:'250',earnings:'5250'}},
   currencyCode:'USD'};
 const paidEvent={eventId:'evt_'+'a'.repeat(26),eventType:EventName.SubscriptionCreated,
   data:{id:subscriptionId,status:'active',customData:{light_remote_account_id:'owner',light_remote_plan:'pro_team'}}};
 const activated=await billing.processEvent(paidEvent);
 assert.equal(activated.action,'team_subscription_verified');
 assert.equal(owner.plan,'pro');
 assert.equal(grant.source,'paddle:'+subscriptionId);
 assert.equal(grant.budget,5000);
 const duplicate=await billing.processEvent(paidEvent);
 assert.equal(duplicate.duplicate,true);
 assert.equal(operations.filter(x=>x.type==='operator'&&x.url.endsWith('/team-entitlement')&&x.method==='POST').length,1);
 const purchase=await billing.processEvent({eventId:'evt_'+'b'.repeat(26),
   eventType:EventName.TransactionCompleted,data:{id:transactionId}});
 assert.equal(purchase.action,'recorded_team');
 assert.equal(purchases.length,1);
 assert.equal(purchases[0].plan_code,'PRO_TEAM','price ID outranks forged Pro customData');
 assert.equal(purchases[0].amount,55);
 assert.equal(mails.length,1);
 assert.equal(mails[0].plan,'Pro Team');
 const ledger=await billing.adminBillingTransactions({limit:10});
 assert.equal(ledger.transactions.length,1);
 assert.equal(ledger.transactions[0].plan,'pro_team','admin revenue listing must trust price ID, not Pro metadata');
 sub.status='past_due';
 const late=await billing.processEvent({eventId:'evt_'+'g'.repeat(26),
   eventType:EventName.SubscriptionPastDue,data:{id:subscriptionId,status:'past_due',
     customData:{light_remote_account_id:'owner'}}});
 assert.equal(late.action,'subscription_inactive');
 assert.equal(grant,null);
 assert.equal(owner.plan,'free');
 sub.status='active';
 const resumed=await billing.processEvent({eventId:'evt_'+'h'.repeat(26),
   eventType:EventName.SubscriptionResumed,data:{id:subscriptionId,status:'active',
     customData:{light_remote_account_id:'owner'}}});
 assert.equal(resumed.action,'team_subscription_verified');
 assert.equal(owner.plan,'pro');
 assert(grant);
 sub.status='paused';
 const paused=await billing.processEvent({eventId:'evt_'+'j'.repeat(26),
   eventType:EventName.SubscriptionPaused,data:{id:subscriptionId,status:'paused',
     customData:{light_remote_account_id:'owner'}}});
 assert.equal(paused.action,'subscription_inactive');
 assert.equal(grant,null);
 sub.status='active';
 await billing.processEvent({eventId:'evt_'+'k'.repeat(26),
   eventType:EventName.SubscriptionActivated,data:{id:subscriptionId,status:'active',
     customData:{light_remote_account_id:'owner'}}});
 assert(grant);
 sub.items=[{price:{id:id('a')}}]; // same sub, paid Team -> individual Pro
 const downgraded=await billing.processEvent({eventId:'evt_'+'c'.repeat(26),
   eventType:EventName.SubscriptionUpdated,data:{id:subscriptionId,status:'active',customData:{light_remote_account_id:'owner'}}});
 assert.equal(downgraded.action,'pro_subscription_verified');
 assert.equal(grant,null,'downgrade must revoke only matching Team grant');
 sub.items=[{price:{id:id('c')}}];
 const reupgrade=await billing.processEvent({eventId:'evt_'+'d'.repeat(26),
   eventType:EventName.SubscriptionUpdated,data:{id:subscriptionId,status:'active',customData:{light_remote_account_id:'owner'}}});
 assert.equal(reupgrade.action,'team_subscription_verified');
 assert(grant);
 await assert.rejects(()=>billing.createSandboxOfferCheckout(owner,{product:'pro_team',period:'yearly'}),
   /paddle_subscription_change_required/,'paid owner must not get a 2nd subscription');
 const badEvent={eventId:'evt_'+'e'.repeat(26),eventType:EventName.SubscriptionUpdated,
   data:{id:subscriptionId,status:'active',customData:{light_remote_account_id:'forged-owner',light_remote_plan:'pro_team'}}};
 await assert.rejects(()=>billing.processEvent(badEvent),/account_mismatch/);
 assert.equal(grant.source,'paddle:'+subscriptionId);
 // Approved full refund: only the matching owner grant is canceled.
 const adjustment={id:'adj_'+'f'.repeat(26),action:'refund',status:'approved',
   transactionId,subscriptionId,type:'full',
   totals:{grandTotal:'5500'},payoutTotals:{retainedFee:'100'}};
 const result=await billing.processEvent({eventId:'evt_'+'f'.repeat(26),
   eventType:EventName.AdjustmentUpdated,data:adjustment});
 assert.equal(result.action,'refund_approved');
 assert.equal(subscriptionCanceled,true);
 assert.equal(grant,null);
 assert.equal(owner.plan,'free');
 assert.equal(refunds.length,1);
 assert.equal(refunds[0].plan_code,'PRO_TEAM');
 assert.equal(refunds[0].retained_fee,1);
 assert.equal((await billing.processEvent({eventId:'evt_'+'f'.repeat(26),
   eventType:EventName.AdjustmentUpdated,data:adjustment})).duplicate,true);
 assert.equal(refunds.length,1,'duplicate refund must not resend ERPNext refund event');
 const disabled=new PaddleBilling({config:{...config,teamSandboxEnabled:false,stateFile:path.join(tmp,'disabled.json')},
   paddleClient:fake,operatorCall,now:()=>now});
 await assert.rejects(()=>disabled.createSandboxOfferCheckout({accountId:'new',email:'new@test',plan:'free'},{
   product:'pro_team',period:'monthly'}),/not_enabled/);
 console.log('sandbox_team_offer_checkout_distinct_price_id=PASS');
 console.log('sandbox_team_paddle_price_amount_usd_cycle_verified=PASS');
 console.log('sandbox_team_verified_price_webhook_and_pro_owner_grant=PASS');
 console.log('sandbox_team_renewal_idempotency_and_member_budget=PASS');
 console.log('sandbox_team_purchase_backoffice_plan_code_and_mail=PASS');
 console.log('sandbox_team_paid_upgrade_requires_subscription_change=PASS');
 console.log('sandbox_team_downgrade_and_source_matched_cancel=PASS');
 console.log('sandbox_team_spoofed_metadata_rejected=PASS');
 console.log('sandbox_team_refund_erpnext_event_and_retained_fee=PASS');
 console.log('sandbox_team_past_due_pause_resume_reconciled=PASS');
 console.log('sandbox_team_admin_transactions_verified_plan=PASS');
 console.log('sandbox_team_feature_flag_fail_closed=PASS');
}finally{fs.rmSync(tmp,{force:true,recursive:true})}
