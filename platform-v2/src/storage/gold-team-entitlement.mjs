/**
 * Shared SQL predicate for active paid Team device authority.
 * Caller query MUST provide an lr_teams alias `t`. This predicate is
 * never influenced by HTTP/body values, and works across Core/Agent/Usage.
 */
export const GOLD_TEAM_ENTITLED_SQL=
 "EXISTS(SELECT 1 FROM lr_accounts team_billing "+
 "JOIN lr_entitlements team_ent ON team_ent.owner_account_id=team_billing.account_id "+
 "WHERE team_billing.account_id=t.owner_account_id "+
 "AND team_billing.status='active' AND team_billing.plan='pro' "+
 "AND team_ent.kind IN ('personal_pro','pro_team') "+
 "AND team_ent.revoked_at IS NULL AND team_ent.effective_at<=now() "+
 "AND (team_ent.valid_until IS NULL OR team_ent.valid_until>now()))";
