/** Final Gold-only Pro Team synthetic fixture cleanup.
 * REQUIRE Operator and Plugin stopped; no other team or account may be altered.
 * PostgreSQL typed rows only; source fixture emails are *.example.invalid.
 */
import assert from 'node:assert/strict';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldNativeProTeam} from '../../lib/gold-native-pro-team.mjs';
assert.equal(process.env.LIGHT_REMOTE_GOLD_INDEPENDENT,'1');
assert.equal(process.env.LR_GOLD_INSTANCE_ID,'uat19');
assert.equal(process.env.GOLD_TEAM_DB_CLEANUP,'YES_ISOLATED_SYNTHETIC_ONLY');
const db=await connectGoldStorage(),pool=db.pool;
const ownerEmail='gold-native-uat-20261019@example.invalid';
const emails=Array.from({length:5},(_,i)=>'gold-team-http-uat-m'+(i+1)+'@example.invalid');
const count=async table=>Number((await pool.query('SELECT count(*)::int n FROM '+table)).rows[0].n);
try{
 const q=await pool.query('SELECT account_id FROM lr_accounts WHERE email=$1',[ownerEmail]);
 assert.equal(q.rowCount,1,'owner_fixture_missing');
 const owner=q.rows[0].account_id;
 const teams=await pool.query('SELECT owner_account_id FROM lr_teams');
 assert.equal(teams.rowCount,1,'refuse_multiple_teams');
 assert.equal(teams.rows[0].owner_account_id,owner);
 const members=await pool.query('SELECT account_id FROM lr_team_members');
 assert.equal(members.rowCount,1,'refuse_non_cleanup_members');
 assert.equal(members.rows[0].account_id,owner);
 const registered=await pool.query('SELECT account_id,email FROM lr_accounts WHERE email=ANY($1::text[])',[emails]);
 assert.equal(registered.rowCount,5,'refuse_unknown_test_accounts');
 for(const [table,wanted] of [
   ['lr_gold_team_entitlements',0],
   ['lr_gold_team_shared_devices',0],
   ['lr_gold_team_invite_codes',0],
   ['lr_gold_team_notification_reads',0]
 ]) assert.equal(await count(table),wanted,'refuse_unexpected_'+table);
 // Single-writer guarantee: both canonical processes stopped before this stage.
 const adapter=await GoldNativeProTeam.open({pool});
 await adapter.store.write({schemaVersion:1,teams:[],teamGrants:[],invites:[],notificationReads:[],emailInviteEvents:[]});
 const deleted=await pool.query('DELETE FROM lr_accounts WHERE email=ANY($1::text[]) RETURNING account_id',[emails]);
 assert.equal(deleted.rowCount,5,'synthetic_accounts_cleanup_mismatch');
 const tables=['lr_teams','lr_team_members','lr_gold_team_shared_devices','lr_gold_team_entitlements',
  'lr_gold_team_invite_codes','lr_gold_team_notification_reads','lr_gold_team_email_invite_events'];
 for(const table of tables)assert.equal(await count(table),0,'team_residue_'+table);
 assert.equal((await pool.query('SELECT count(*)::int n FROM lr_accounts WHERE email=ANY($1::text[])',[emails])).rows[0].n,0);
 assert.equal((await pool.query('SELECT plan FROM lr_accounts WHERE account_id=$1',[owner])).rows[0].plan,'pro','original_owner_plan_changed');
 console.log('GOLD_TEAM_REAL_PG17_SYNTHETIC_CLEANUP=PASS');
}finally{await db.close()}
