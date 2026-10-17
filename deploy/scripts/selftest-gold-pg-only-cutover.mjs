import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectGoldPgOnlyCutover,assertGoldPgOnlyBoot,GOLD_DOMAINS}
 from '../../lib/gold-pg-only-gate.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('Gold full cutover tracks every required state authority',()=>{
 const scan=inspectGoldPgOnlyCutover();
 assert.equal(scan.required,GOLD_DOMAINS.length);
 assert(scan.required>=23,'incomplete domain inventory');
 const names=new Set(scan.domains.map(d=>d.name));
 for(const key of ['accounts','account_sessions','device_inventory','enrollments',
  'connection_leases','ab_grants','ab_pairing_requests','agent_clients','sessions',
  'pro_team','usage','licenses','notifications','oauth_authorization',
  'paddle_billing','support_outbox','site_announcements','site_analytics'])
  assert(names.has(key),'missing acceptance gate: '+key);
 assert(scan.unresolved>0,'dangerous false Gold acceptance');
 assert.equal(scan.complete+scan.unresolved,scan.required);
 assert(!scan.ok);
});
test('Gold pg-only refuses both legacy and partially migrated runtime',()=>{
 assert.deepEqual(assertGoldPgOnlyBoot({role:'operator',env:{}}),{active:false});
 assert.throws(()=>assertGoldPgOnlyBoot({role:'operator',
  env:{LR_GOLD_PG_ONLY:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'0'}}),
  /gold_pg_only_independent_mode_required/);
 for(const role of ['operator','plugin']){
  assert.throws(()=>assertGoldPgOnlyBoot({role,
   env:{LR_GOLD_PG_ONLY:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'1'}}),
   error=>error.code==='GOLD_PG_ONLY_NOT_READY'&&error.pending.includes('accounts')
    &&error.pending.includes('paddle_billing'));
 }
});
test('Operator and Plugin reject PostgreSQL-only startup before listening',()=>{
 for(const [role,entry,cwd] of [
  ['operator','operator-host/executor.mjs',root],
  ['plugin','plugin-server/server.mjs',path.join(root,'plugin-server')]
 ]){
  const isolated='/tmp/lr-gold-cutover-gate-example';
  const inside=f=>isolated+'/'+f;
  const p=spawnSync(process.execPath,[path.join(root,entry)],{
   cwd,encoding:'utf8',timeout:6000,maxBuffer:15000,
   env:{PATH:process.env.PATH||'/usr/bin:/bin',HOME:'/tmp',NODE_ENV:'test',
    LR_GOLD_PG_ONLY:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
    LIGHT_REMOTE_GOLD_ROOT:isolated,
    OPERATOR_SOCKET:inside('run/operator.sock'),
    OPERATOR_STATE_DIR:inside('state/operator'),
    OPERATOR_LOG_DIR:inside('logs/operator'),
    OPERATOR_KEY_FILE:inside('secrets/operator.private'),
    LIGHT_REMOTE_PLUGIN_HOST:'127.0.0.1',
    LIGHT_REMOTE_PLUGIN_ORIGIN:'http://127.0.0.1:5979',
    LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK:'1',
    LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:inside('secrets/oauth'),
    LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE:inside('state/oauth-clients'),
    LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE:inside('state/recovery'),
    LIGHT_REMOTE_PADDLE_STATE_FILE:inside('state/paddle'),
    LIGHT_REMOTE_SITE_ANALYTICS_PATH:inside('state/analytics'),
    LIGHT_REMOTE_SITE_CONTENT_PATH:inside('state/content'),
    LIGHT_REMOTE_SUPPORT_OUTBOX_FILE:inside('state/support'),
    LIGHT_REMOTE_GOOGLE_OAUTH_FILE:inside('state/google'),
    LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE:inside('secrets/backoffice'),
    LIGHT_REMOTE_DISTRIBUTION_DIR:inside('distribution'),
    LIGHT_REMOTE_MAIL_ENV_FILE:inside('secrets/mail'),
    LIGHT_REMOTE_OPENAI_CHALLENGE_FILE:inside('secrets/challenge')}
  });
  assert.equal(p.status,1,role+': failed to reject incomplete cutover: '+(p.stderr||'').slice(-650));
  assert.match(p.stderr,/gold_pg_only_cutover_incomplete:/);
  assert.doesNotMatch(p.stdout,/direct_plugin_listen|operator_listening/);
 }
});
test('Site/notification/support canary flags cannot bypass full cutover',()=>{
 for(const role of ['operator','plugin']){
  assert.throws(()=>assertGoldPgOnlyBoot({role,env:{
   LR_GOLD_PG_ONLY:'1',LIGHT_REMOTE_GOLD_INDEPENDENT:'1',
   LR_GOLD_NOTIFICATIONS_PG:'1',LR_GOLD_SITE_ANNOUNCEMENTS_PG:'1',
   LR_GOLD_SITE_ANALYTICS_PG:'1',LR_GOLD_SUPPORT_OUTBOX_PG:'1'
  }}),/gold_pg_only_cutover_incomplete:/);
 }
});
