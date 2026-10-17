/**
 * Account billing eligibility is projected from two PostgreSQL authorities:
 * an active verified Account session, and a current unrevoked entitlement.
 * Neither a client-supplied accountId nor lr_accounts.plan alone is sufficient
 * to grant paid features.
 */
const fail=(message,status=403)=>Object.assign(new Error(message),{code:message,status});
const epoch=value=>value==null?null:new Date(value).getTime();
export class GoldPgAccountEntitlementAuthority{
 constructor({pool,core}={}){
  if(typeof pool?.query!=='function')throw Error('gold_account_entitlement_pool_required');
  if(typeof core?.authenticate!=='function')
   throw Error('gold_account_entitlement_auth_required');
  this.pool=pool;this.core=core;
 }
 async view({sessionToken,includePrincipal=false}={}){
  const principal=await this.core.authenticate(sessionToken);
  const result=await this.pool.query(
   "SELECT a.account_id,a.plan,a.status,a.email_verified,a.password_enabled,"+
   "a.google_sub,a.created_at,a.last_login_at,e.entitlement_id,e.kind,e.source,"+
   "e.source_ref,e.effective_at,e.valid_until "+
   "FROM lr_accounts a LEFT JOIN LATERAL ("+
   "SELECT entitlement_id,kind,source,source_ref,effective_at,valid_until "+
   "FROM lr_entitlements WHERE owner_account_id=a.account_id "+
   "AND revoked_at IS NULL AND effective_at<=now() "+
   "AND (valid_until IS NULL OR valid_until>now()) "+
   "AND ((a.plan='pro' AND kind IN ('personal_pro','pro_team','trial')) "+
   "OR (a.plan='vip' AND kind='vip')) "+
   "ORDER BY CASE kind WHEN 'vip' THEN 4 WHEN 'pro_team' THEN 3 "+
   "WHEN 'personal_pro' THEN 2 ELSE 1 END DESC,effective_at DESC LIMIT 1"+
   ") e ON true WHERE a.account_id=$1 AND a.status='active' "+
   "AND a.email_verified=true",[principal.accountId]);
  if(result.rows?.length!==1)throw fail('gold_account_entitlement_account_inactive',403);
  const row=result.rows[0];
  const active=Boolean(row.entitlement_id);
  const plan=active?row.plan:'free';
  const kind=active?row.kind:null;
  const data=active?{
   entitlementId:row.entitlement_id,kind:row.kind,
   source:row.source,sourceRef:row.source_ref,
   validFrom:epoch(row.effective_at),validUntil:epoch(row.valid_until)
  }:null;
  return {accountId:principal.accountId,plan,paid:active,
   teamEligible:plan==='pro'&&['personal_pro','pro_team'].includes(kind),
   entitlement:data,
   // Explicitly no guessed fleet/usage limits: they depend on a separate
   // current plan policy + usage ledger cutover.
   policyAccepted:false,
   ...(includePrincipal?{verifiedPrincipal:principal,
    profileFields:{emailVerified:row.email_verified===true,
     authProviders:[...(row.password_enabled===true?['password']:[]),
      ...(row.google_sub?['google']:[])],
     createdAt:epoch(row.created_at),lastLoginAt:epoch(row.last_login_at)}}:{})};
 }
 async profile({sessionToken}={}){
  const {verifiedPrincipal:principal,profileFields:fields,...access}=
   await this.view({sessionToken,includePrincipal:true});
  const entitlement=access.entitlement?{
   ...access.entitlement,plan:access.plan,
   grantedAt:access.entitlement.validFrom
  }:{entitlementId:null,plan:'free',kind:null,source:'none',
   sourceRef:null,validFrom:null,validUntil:null,grantedAt:null};
  return{account:{
   accountId:principal.accountId,email:principal.email,
   groupId:principal.groupId,plan:access.plan,entitlement,
   paid:access.paid,teamEligible:access.teamEligible,
   policyAccepted:false,
   emailVerified:fields.emailVerified,authProviders:fields.authProviders,
   status:'active',createdAt:fields.createdAt,lastLoginAt:fields.lastLoginAt
  },session:{sessionId:principal.sessionId,expiresAt:principal.expiresAt}};
 }
}
