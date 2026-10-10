import { verifiedSubscriptionOffer } from './paddle-sandbox-offers.mjs';

const SOURCE='paddle:';
const activeStatuses=new Set(['active','trialing']);
const deny=(code,status=409)=>{throw Object.assign(new Error(code),{status})};
const text=x=>String(x??'').trim();

/**
 * Sandbox-only, trusted Paddle.subscription.get() snapshot transition logic.
 * It does not call Paddle externally and NEVER reads plan names from webhook
 * metadata. It resolves product+period from a verified configured price ID.
 */
export class PaddleSandboxTeamCoordinator {
  constructor({config,operatorCall,now=()=>Date.now()}={}){
    if(config?.environment!=='sandbox'||config?.teamSandboxEnabled!==true||
      typeof operatorCall!=='function'||typeof now!=='function')
      deny('sandbox_team_coordinator_disabled',403);
    this.config=config;this.call=operatorCall;this.now=now;
  }
  async current(accountId){
    const r=await this.call('GET','/v1/admin/accounts/'+encodeURIComponent(accountId));
    if(!r?.account)deny('sandbox_team_account_not_found',404);
    return r.account;
  }
  async revokeTeam(accountId,subscriptionId){
    return this.call('DELETE','/v1/admin/accounts/'+encodeURIComponent(accountId)+'/team-entitlement',
      {expectedSource:SOURCE+subscriptionId});
  }
  async apply(subscription,{expectedAccountId=null}={}){
    const offer=verifiedSubscriptionOffer(this.config,subscription,{expectedAccountId});
    const account=await this.current(offer.accountId);
    const entitlement=account.entitlement||{};
    const active=activeStatuses.has(offer.status),sub=offer.subscriptionId;
    const currentSource=text(entitlement.source),currentRef=text(entitlement.sourceRef);
    if(!active){
      const team=await this.revokeTeam(offer.accountId,sub);
      let pro='untouched';
      if(currentSource==='paddle'&&currentRef===sub){
        await this.call('POST','/v1/admin/accounts/'+encodeURIComponent(offer.accountId)+'/entitlement/revoke',
          {source:'paddle',reason:'paddle:'+sub});
        pro='revoked';
      }
      return {action:'subscription_inactive',product:offer.product,period:offer.period,
        accountId:offer.accountId,subscriptionId:sub,teamRevoked:Boolean(team?.revoked),pro};
    }
    if(currentSource==='paddle'&&currentRef&&currentRef!==sub)
      deny('different_paddle_subscription_owns_plan',409);
    if(text(account.plan).toLowerCase()==='free'){
      await this.call('POST','/v1/admin/accounts/'+encodeURIComponent(offer.accountId)+'/entitlement',
        {plan:'pro',source:'paddle',sourceRef:sub,allowDowngrade:false});
    }
    if(offer.product==='pro'){
      await this.revokeTeam(offer.accountId,sub);
      return {action:'pro_subscription_verified',accountId:offer.accountId,subscriptionId:sub,
        period:offer.period,teamEnabled:false};
    }
    const next=Date.parse(text(subscription?.nextBilledAt||subscription?.next_billed_at||
      subscription?.currentBillingPeriod?.endsAt||subscription?.current_billing_period?.ends_at));
    if(!Number.isFinite(next)||next<=this.now()+60000)
      deny('sandbox_team_renewal_date_required',409);
    const budget=Number(this.config.teamUatCallBudget??5000);
    if(!Number.isSafeInteger(budget)||budget<1||budget>1000000)
      deny('sandbox_team_budget_invalid',503);
    // A paid subscription cannot outlive its billing period without another
    // verified renewal event. No auto-grant from account metadata.
    const validUntil=next;
    const r=await this.call('POST','/v1/admin/accounts/'+encodeURIComponent(offer.accountId)+'/team-entitlement',
      {validUntil,monthlyMemberCallBudget:budget,source:SOURCE+sub});
    if(!r?.grant?.active)deny('sandbox_team_grant_unconfirmed',502);
    return {action:'team_subscription_verified',accountId:offer.accountId,
      subscriptionId:sub,period:offer.period,teamEnabled:true,validUntil,budget};
  }
}
