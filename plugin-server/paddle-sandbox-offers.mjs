import { LIGHT_REMOTE_PLAN_OFFERS } from '../lib/light-remote-plan-offers.mjs';

const PRICE_ID=/^pri_[a-z0-9]{26}$/;
const PRODUCTS=new Set(['pro','pro_team']);
const PERIODS=new Set(['monthly','yearly']);
const CATALOG=Object.freeze({
  pro: Object.freeze({monthly:'proMonthlyPriceId',yearly:'proYearlyPriceId'}),
  pro_team: Object.freeze({monthly:'teamMonthlyPriceId',yearly:'teamYearlyPriceId'}),
});
const get=(o,k)=>String(o?.[k]||'').trim();
const asError=(error,status=409)=>Object.assign(new Error(error),{status});

export function sandboxOfferCatalog(config={}){
  const map=Object.create(null),seen=new Set(),environment=String(config.environment||'');
  const sandbox=environment==='sandbox';
  for(const product of PRODUCTS)for(const period of PERIODS){
    const key=CATALOG[product][period],id=get(config,key);
    if(!id)continue;
    if(!PRICE_ID.test(id))throw asError('paddle_offer_price_id_invalid',400);
    if(seen.has(id))throw asError('paddle_offer_duplicate_price_id',400);
    seen.add(id);
    map[product+':'+period]=Object.freeze({
      product,period,priceId:id,
      amountUSD:product==='pro'?(period==='monthly'?LIGHT_REMOTE_PLAN_OFFERS.pro.priceUSD:LIGHT_REMOTE_PLAN_OFFERS.pro.annualPriceUSD):
        (period==='monthly'?LIGHT_REMOTE_PLAN_OFFERS.proTeam.priceUSD:LIGHT_REMOTE_PLAN_OFFERS.proTeam.annualPriceUSD)
    });
  }
  return Object.freeze({sandbox,offers:Object.freeze(map)});
}
export function resolveSandboxOffer(config,{product,period}={}){
  if(!PRODUCTS.has(product)||!PERIODS.has(period))throw asError('paddle_offer_invalid',400);
  const catalog=sandboxOfferCatalog(config);
  if(!catalog.sandbox||config.teamSandboxEnabled!==true)
    throw asError('paddle_team_sandbox_not_enabled',403);
  const row=catalog.offers[product+':'+period];
  if(!row)throw asError('paddle_offer_price_not_configured',503);
  return row;
}
export function verifiedSubscriptionOffer(config,subscription,{expectedAccountId=null}={}){
  const catalog=sandboxOfferCatalog(config);
  if(!catalog.sandbox||config.teamSandboxEnabled!==true)
    throw asError('paddle_team_sandbox_not_enabled',403);
  const ids=(subscription?.items||[]).map(item=>String(item?.price?.id||item?.priceId||item?.price_id||'')).filter(Boolean);
  if(ids.length!==1)throw asError('paddle_subscription_items_not_exclusive',403);
  const offer=Object.values(catalog.offers).find(row=>row.priceId===ids[0]);
  if(!offer)throw asError('paddle_subscription_price_not_approved',403);
  const custom=subscription?.customData||subscription?.custom_data||{};
  const accountId=String(custom.light_remote_account_id||custom.lightRemoteAccountId||'').trim();
  if(!accountId||(expectedAccountId&&expectedAccountId!==accountId))
    throw asError('paddle_subscription_account_mismatch',403);
  const id=String(subscription?.id||'').trim();
  if(!/^sub_[a-z0-9]{20,}$/.test(id))throw asError('paddle_subscription_id_invalid',403);
  return Object.freeze({accountId,subscriptionId:id,...offer,status:String(subscription?.status||'').toLowerCase()});
}
export function assertSandboxPriceDetails(offer,price,{allowArchived=false}={}){
  if(!offer||!price||String(price.id)!==offer.priceId)
    throw asError('paddle_price_snapshot_mismatch',403);
  const amount=String(price?.unitPrice?.amount??price?.unit_price?.amount??'');
  const currency=String(price?.unitPrice?.currencyCode??price?.unit_price?.currency_code??'');
  const cycle=price?.billingCycle||price?.billing_cycle||{};
  const interval=offer.period==='monthly'?'month':'year';
  if(amount!==String(offer.amountUSD*100)||currency.toUpperCase()!=='USD'||
     String(cycle.interval)!==interval||Number(cycle.frequency)!==1)
    throw asError('paddle_price_amount_cycle_mismatch',403);
  if(!allowArchived&&String(price.status)!=='active')
    throw asError('paddle_price_not_active',403);
  return offer;
}
export function verifiedTransactionOffer(config,transaction,{expectedAccountId=null}={}){
  const catalog=sandboxOfferCatalog(config);
  if(!catalog.sandbox||config.teamSandboxEnabled!==true)
    throw asError('paddle_team_sandbox_not_enabled',403);
  const ids=(transaction?.items||[]).map(item=>String(
    item?.price?.id||item?.priceId||item?.price_id||'')).filter(Boolean);
  if(ids.length!==1)throw asError('paddle_transaction_items_not_exclusive',403);
  const offer=Object.values(catalog.offers).find(row=>row.priceId===ids[0]);
  if(!offer)throw asError('paddle_transaction_price_not_approved',403);
  const custom=transaction?.customData||transaction?.custom_data||{};
  const accountId=String(custom.light_remote_account_id||custom.lightRemoteAccountId||'').trim();
  if(!accountId||expectedAccountId&&expectedAccountId!==accountId)
    throw asError('paddle_transaction_account_mismatch',403);
  const transactionId=String(transaction?.id||'');
  const subscriptionId=String(transaction?.subscriptionId||transaction?.subscription_id||'');
  if(!/^txn_[a-z0-9]{20,}$/.test(transactionId)||!/^sub_[a-z0-9]{20,}$/.test(subscriptionId))
    throw asError('paddle_transaction_binding_invalid',403);
  return Object.freeze({accountId,transactionId,subscriptionId,...offer});
}
export function chooseSandboxCheckoutAction({account,offer,latestSubscription=null}={}){
  if(!account?.accountId||!account?.email||!offer)throw asError('paddle_account_or_offer_required',400);
  const status=String(latestSubscription?.status||'').toLowerCase();
  if(['active','trialing','past_due','paused'].includes(status))
    return Object.freeze({action:'change_existing_subscription',sourceRef:latestSubscription.id,offer});
  if(latestSubscription&&status!=='canceled')
    throw asError('paddle_subscription_status_uncertain',409);
  if(account?.entitlement?.source==='paddle'&&account?.entitlement?.sourceRef&&!latestSubscription)
    throw asError('paddle_subscription_requires_reconciliation',409);
  return Object.freeze({action:'create_new_subscription_checkout',offer});
}
export const sandboxPaddleOffers=Object.freeze({products:[...PRODUCTS],periods:[...PERIODS]});
