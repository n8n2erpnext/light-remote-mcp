import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';
import {AccountNotificationRegistry} from '../../operator-host/account-notification-registry.mjs';
import {verifyTeamPrincipalRequest,TeamPrincipalProofError} from '../../lib/team-oauth-principal-proof.mjs';
import {assertGoldRuntimeIsolation} from '../../lib/gold-runtime-isolation.mjs';
const exec=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const deps=exec.slice(exec.indexOf('const routeDeps=()=>({'),exec.indexOf('const server = http.createServer('));
for(const dep of ['accountNotifications','proTeams','teamSessions','requestTeamMemberApproval','operationalAccount','verifyTeamPrincipal']){
  assert.match(deps,new RegExp('\\b'+dep+'\\b'),'missing production route dependency: '+dep);
}
assert.match(exec,/const teamSessions=null;/,'UAT-only sessions must not be enabled');
assert.match(exec,/stateFile:NOTIFICATIONS_STATE_FILE/);
assert.match(exec,/stateFile:TEAM_STATE_FILE/);
assert.match(exec,/const teamInviteKey=teamInviteSecretFile\?fs\.readFileSync/);
assert.match(exec,/new TeamPrincipalProofVerifier\(/);
assert.match(exec,/assertGoldRuntimeIsolation\(process.env,'operator'\)/);
const notifications=new AccountNotificationRegistry();
const published=notifications.publish({type:'security',title:'Scoped notice',body:'Account specific only',audienceType:'account',audienceValue:'acct_01'});
assert.equal(notifications.inbox('acct_01',{plan:'free'}).notifications[0].notificationId,published.notificationId);
assert.equal(notifications.inbox('acct_02',{plan:'free'}).notifications.length,0);
const team=new ProTeamRegistry({planFor:()=> 'free'});
assert.equal(team.teamEntitlement('acct_01').active,false);
assert.throws(()=>verifyTeamPrincipalRequest({headers:{}},{pathname:'/v1/team/request'},{},null), e=>e instanceof TeamPrincipalProofError&&e.status===503);
assert.deepEqual(assertGoldRuntimeIsolation({},'operator'),{isolated:false});
console.log('GOLD_OPERATOR_TEAM_NOTIFICATION_DEP_INJECTION_SOURCE_PASS');
console.log('GOLD_TEAM_PROOF_MISSING_KEY_FAIL_CLOSED_PASS');
console.log('GOLD_NOTICE_ACCOUNT_ISOLATION_PASS');
