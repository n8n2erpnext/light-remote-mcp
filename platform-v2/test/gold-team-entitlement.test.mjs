import test from 'node:test';
import assert from 'node:assert/strict';
import {GOLD_TEAM_ENTITLED_SQL} from '../src/storage/gold-team-entitlement.mjs';

test('Gold Team authority requires actual owner Pro plan with currently paid unrevoked entitlement',()=>{
 const sql=GOLD_TEAM_ENTITLED_SQL;
 assert(sql.includes('t.owner_account_id'));
 assert(sql.includes("team_billing.plan='pro'"));
 assert(sql.includes("team_billing.status='active'"));
 assert(sql.includes("('personal_pro','pro_team')"));
 assert(sql.includes('team_ent.revoked_at IS NULL'));
 assert(sql.includes('team_ent.effective_at<=now()'));
 assert(sql.includes('team_ent.valid_until>now()'));
 assert(!sql.includes('actor_account_id=$'), 'billing entitlement belongs to Team owner');
 assert(!sql.includes('OR 1=1'));
});
