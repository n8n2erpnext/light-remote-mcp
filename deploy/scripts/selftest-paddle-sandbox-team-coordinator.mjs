import assert from 'node:assert/strict';
import { sandboxOfferCatalog,resolveSandboxOffer,verifiedSubscriptionOffer,assertSandboxPriceDetails,
  chooseSandboxCheckoutAction } from '../../plugin-server/paddle-sandbox-offers.mjs';
import { PaddleSandboxTeamCoordinator } from '../../plugin-server/paddle-sandbox-team-coordinator.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
const id=n=>'pri_'+n.repeat(26);
const subId='sub_'+'x'.repeat(26);
const config={environment:'sandbox',teamSandboxEnabled:true,
  proMonthlyPriceId:id('a'),proYearlyPriceId:id('b'),
  teamMonthlyPriceId:id('c'),teamYearlyPriceId:id('d'),
  teamUatCallBudget:5000};
const catalog=sandboxOfferCatalog(config).offers;
assert.equal(Object.keys(catalog).length,4);
assert.equal(catalog['pro:monthly'].amountUSD,20);
assert.equal(catalog['pro:yearly'].amountUSD,200);
assert.equal(catalog['pro_team:monthly'].amountUSD,55);
assert.equal(catalog['pro_team:yearly'].amountUSD,550);
for(const offer of Object.values(catalog)){
  const period=offer.period==='monthly'?'month':'year';
  const valid={id:offer.priceId,status:'active',unitPrice:{amount:String(offer.amountUSD*100),currencyCode:'USD'},
    billingCycle:{interval:period,frequency:1}};
  assert.equal(assertSandboxPriceDetails(offer,valid).priceId,offer.priceId);
  assert.throws(()=>assertSandboxPriceDetails(offer,{...valid,
    unitPrice:{amount:'100',currencyCode:'USD'}}),/amount_cycle_mismatch/);
  assert.throws(()=>assertSandboxPriceDetails(offer,{...valid,
    unitPrice:{amount:String(offer.amountUSD*100),currencyCode:'EUR'}}),/amount_cycle_mismatch/);
  assert.throws(()=>assertSandboxPriceDetails(offer,{...valid,billingCycle:{interval:'week',frequency:1}}),
    /amount_cycle_mismatch/);
  assert.throws(()=>assertSandboxPriceDetails(offer,{...valid,status:'archived'}),/price_not_active/);
  assert.doesNotThrow(()=>assertSandboxPriceDetails(offer,{...valid,status:'archived'},{allowArchived:true}));
}

assert.equal(resolveSandboxOffer(config,{product:'pro_team',period:'yearly'}).priceId,id('d'));
assert.throws(()=>sandboxOfferCatalog({...config,teamMonthlyPriceId:id('a')}),/duplicate_price_id/);
assert.throws(()=>sandboxOfferCatalog({...config,teamMonthlyPriceId:'pri_fake'}),/price_id_invalid/);
assert.throws(()=>resolveSandboxOffer({...config,environment:'production'},{product:'pro_team',period:'monthly'}),/not_enabled/);
assert.throws(()=>resolveSandboxOffer({...config,teamSandboxEnabled:false},{product:'pro_team',period:'monthly'}),/not_enabled/);
assert.throws(()=>resolveSandboxOffer(config,{product:'fake',period:'monthly'}),/offer_invalid/);
assert.throws(()=>resolveSandboxOffer({...config,teamYearlyPriceId:''},{product:'pro_team',period:'yearly'}),/not_configured/);
assert.equal(chooseSandboxCheckoutAction({account:{accountId:'owner',email:'a@test'},offer:catalog['pro_team:monthly']}).action,'create_new_subscription_checkout');
assert.equal(chooseSandboxCheckoutAction({account:{accountId:'owner',email:'a@test'},offer:catalog['pro_team:monthly'],
 latestSubscription:{id:subId,status:'active'}}).action,'change_existing_subscription');
assert.throws(()=>chooseSandboxCheckoutAction({account:{accountId:'owner',email:'a@test',entitlement:{source:'paddle',sourceRef:subId}},
 offer:catalog['pro:monthly']}),/requires_reconciliation/);
const makeSub=({price=id('c'),status='active',account='owner',renewal='2027-01-01T00:00:00.000Z'}={})=>({
 id:subId,status,items:[{price:{id:price}}],nextBilledAt:renewal,
 customData:{light_remote_account_id:account,light_remote_plan:'pro'} // intentionally misleading: Team only by price
});
const sub=makeSub();
assert.equal(verifiedSubscriptionOffer(config,sub).product,'pro_team');
assert.throws(()=>verifiedSubscriptionOffer(config,{...sub,items:[...sub.items,{price:{id:id('a')}}]}),/items_not_exclusive/);
assert.throws(()=>verifiedSubscriptionOffer(config,makeSub({price:id('z')})),/price_not_approved/);
assert.throws(()=>verifiedSubscriptionOffer(config,sub,{expectedAccountId:'other'}),/account_mismatch/);
let now=Date.UTC(2026,9,10),calls=[];
let account={accountId:'owner',plan:'free',entitlement:{source:'default',sourceRef:null}};
const grant={value:null};
const operatorCall=async(method,url,body={})=>{
  calls.push({method,url,body});
  if(method==='GET'&&url==='/v1/admin/accounts/owner')return {account:structuredClone(account)};
  if(method==='POST'&&url==='/v1/admin/accounts/owner/entitlement'){
    account.plan=body.plan;account.entitlement={source:body.source,sourceRef:body.sourceRef};
    return {account:structuredClone(account)};
  }
  if(method==='POST'&&url==='/v1/admin/accounts/owner/entitlement/revoke'){
    if(account.entitlement.source==='paddle'){
      account.plan='free';account.entitlement={source:'paddle_revoke',sourceRef:null};
    }
    return {account:structuredClone(account)};
  }
  if(method==='POST'&&url==='/v1/admin/accounts/owner/team-entitlement'){
    grant.value={active:true,source:body.source,validUntil:body.validUntil,budget:body.monthlyMemberCallBudget};
    return {grant:grant.value};
  }
  if(method==='DELETE'&&url==='/v1/admin/accounts/owner/team-entitlement'){
    const revoked=Boolean(grant.value?.source===body.expectedSource);
    if(revoked)grant.value=null;
    return {revoked};
  }
  throw Error('unexpected_operator_call '+method+':'+url);
};
const coordinator=new PaddleSandboxTeamCoordinator({config,operatorCall,now:()=>now});
const activated=await coordinator.apply(sub);
assert.equal(activated.action,'team_subscription_verified');
assert.equal(account.plan,'pro');
assert.equal(grant.value.source,'paddle:'+subId);
assert.equal(grant.value.validUntil,Date.parse(sub.nextBilledAt));
assert.equal(grant.value.budget,5000);
assert.equal(activated.period,'monthly');
assert.equal(calls.filter(x=>x.url.endsWith('/entitlement')&&x.method==='POST').length,1);
const again=await coordinator.apply(sub);
assert.equal(again.action,'team_subscription_verified');
assert.equal(calls.filter(x=>x.url.endsWith('/entitlement')&&x.method==='POST').length,1,
  'repeat webhook must not create another owner PRO purchase');
const downgrade=await coordinator.apply(makeSub({price:id('a')}));
assert.equal(downgrade.action,'pro_subscription_verified');
assert.equal(grant.value,null,'plan change Team->Pro must revoke the Team grant for same sub');
assert.equal(account.plan,'pro');
await coordinator.apply(sub);
assert(grant.value);
const canceled=await coordinator.apply(makeSub({status:'canceled'}));
assert.equal(canceled.action,'subscription_inactive');
assert.equal(canceled.teamRevoked,true);
assert.equal(account.plan,'free');
assert.equal(grant.value,null);
const stale=await coordinator.apply(makeSub({status:'canceled'}));
assert.equal(stale.teamRevoked,false,'duplicate cancellation cannot revoke unrelated entitlement');
account.plan='pro';account.entitlement={source:'admin',sourceRef:'manual'};
grant.value={active:true,source:'rc50-isolated-pro-team-uat',validUntil:Date.parse(sub.nextBilledAt)};
const ignored=await coordinator.apply(makeSub({status:'canceled'}));
assert.equal(ignored.teamRevoked,false,'expired event must never delete a different team grant');
assert.equal(account.plan,'pro','manual PRO must never be revoked by unrelated Paddle event');
assert.equal(grant.value.source,'rc50-isolated-pro-team-uat');
account.entitlement={source:'paddle',sourceRef:'sub_'+'y'.repeat(26)};
await assert.rejects(()=>coordinator.apply(sub),/different_paddle_subscription_owns_plan/);
account.entitlement={source:'admin',sourceRef:'manual'};
await assert.rejects(()=>coordinator.apply(makeSub({renewal:'2026-01-01T00:00:00.000Z'})),/renewal_date_required/);
const existingTeam=new ProTeamRegistry({now:()=>now,planFor:()=> 'pro',accountActive:()=>true});
existingTeam.grantTeamAccess({ownerAccountId:'owner',validUntil:now+86400000,source:'staging-uat'});
assert.equal(existingTeam.revokeTeamAccess('owner',{expectedSource:'paddle:'+subId}),false);
assert.equal(existingTeam.teamEntitlement('owner').active,true);
console.log('paddle_sandbox_distinct_four_offers_and_amounts=PASS');
console.log('paddle_sandbox_price_usd_amount_cycle_and_status_validation=PASS');
console.log('paddle_sandbox_subscription_identity_price_verification=PASS');
console.log('paddle_sandbox_no_double_billing_paid_upgrade=PASS');
console.log('paddle_sandbox_team_pro_grant_and_downgrade=PASS');
console.log('paddle_sandbox_expiration_cancel_source_matched_revoke=PASS');
console.log('paddle_sandbox_metadata_spoof_and_unrelated_grant_protected=PASS');
