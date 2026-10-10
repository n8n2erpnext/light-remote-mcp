/**
 * Approved commercial plan positioning. This is product catalog metadata,
 * NOT a Paddle price ID, subscription entitlement or billing authority.
 */
export const LIGHT_REMOTE_PLAN_OFFERS=Object.freeze({
  currency:'USD',
  billingInterval:'month',
  pro:Object.freeze({
    displayName:'Pro',
    priceUSD:20,
    annualPriceUSD:200,
    annualCheckoutEnabled:false,
    seats:1,
    personalToolCalls:'unlimited',
    grantsTeamAccess:false
  }),
  proTeam:Object.freeze({
    displayName:'Pro Team',
    priceUSD:55,
    annualPriceUSD:550,
    annualCheckoutEnabled:false,
    maxSeats:5, // owner + at most 4 member accounts
    maxSharedWorkersPerDevice:3,
    ownerPersonalToolCalls:'unlimited',
    invitedMemberStandalonePlan:'unchanged', // Free stays Free
    teamCalls:'metered_owner_billed',
    teamQuotaCommercialized:false,
    testQuotaLower:20000,
    testQuotaUpper:25000,
    requiresSeparateOwnerTeamEntitlement:true
  })
});
export function validateOfferCatalog(catalog=LIGHT_REMOTE_PLAN_OFFERS){
  if(catalog.currency!=='USD'||catalog.billingInterval!=='month')throw Error('plan_currency_cycle_invalid');
  if(catalog.pro.priceUSD!==20||catalog.proTeam.priceUSD!==55||
     catalog.pro.annualPriceUSD!==200||catalog.proTeam.annualPriceUSD!==550)
    throw Error('plan_price_drift');
  if(catalog.pro.annualCheckoutEnabled!==false||catalog.proTeam.annualCheckoutEnabled!==false)
    throw Error('unconfigured_annual_checkout_enabled');
  if(catalog.pro.seats!==1||catalog.pro.grantsTeamAccess!==false)throw Error('individual_pro_must_not_grant_team');
  const team=catalog.proTeam;
  if(team.maxSeats!==5||team.maxSharedWorkersPerDevice!==3||team.invitedMemberStandalonePlan!=='unchanged')
    throw Error('team_entitlement_drift');
  if(team.teamCalls!=='metered_owner_billed'||team.teamQuotaCommercialized!==false||
      team.testQuotaLower!==20000||team.testQuotaUpper!==25000)throw Error('team_quota_policy_drift');
  return true;
}
