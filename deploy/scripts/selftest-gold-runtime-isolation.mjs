import assert from 'node:assert/strict';
import {assertGoldRuntimeIsolation} from '../../lib/gold-runtime-isolation.mjs';

const root='/tmp/light-remote-gold-example-only';
const paths={
  LIGHT_REMOTE_GOLD_INDEPENDENT:'1', LIGHT_REMOTE_GOLD_ROOT:root,
  OPERATOR_SOCKET:root+'/runtime/operator.sock',
  OPERATOR_STATE_DIR:root+'/state/operator',
  OPERATOR_LOG_DIR:root+'/logs/operator',
  OPERATOR_KEY_FILE:root+'/secrets/operator.private.json',
  LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:root+'/secrets/oauth-secret',
  LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE:root+'/state/plugin/oauth-clients.json',
  LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE:root+'/state/plugin/recovery.json',
  LIGHT_REMOTE_PADDLE_STATE_FILE:root+'/state/plugin/paddle.json',
  LIGHT_REMOTE_SITE_ANALYTICS_PATH:root+'/state/plugin/site-analytics.json',
  LIGHT_REMOTE_SITE_CONTENT_PATH:root+'/state/plugin/content.json',
  LIGHT_REMOTE_SUPPORT_OUTBOX_FILE:root+'/state/plugin/outbox.json',
  LIGHT_REMOTE_GOOGLE_OAUTH_FILE:root+'/state/plugin/google.json',
  LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE:root+'/secrets/backoffice.json',
  LIGHT_REMOTE_MAIL_ENV_FILE:root+'/secrets/mail.env',
  LIGHT_REMOTE_OPENAI_CHALLENGE_FILE:root+'/secrets/openai-challenge',
  LIGHT_REMOTE_DISTRIBUTION_DIR:root+'/distribution',
  LIGHT_REMOTE_PLUGIN_HOST:'127.0.0.1',
  LIGHT_REMOTE_PLUGIN_ORIGIN:'http://127.0.0.1:5979',
  LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK:'1'
};
for(const role of ['operator','plugin'])assert.deepEqual(assertGoldRuntimeIsolation(paths,role),{isolated:true,role});
assert.deepEqual(assertGoldRuntimeIsolation({},'operator'),{isolated:false});
const reject=(changes,role='operator',pattern=/gold_/)=>
  assert.throws(()=>assertGoldRuntimeIsolation({...paths,...changes},role),pattern);
reject({OPERATOR_SOCKET:'/run/gpt-vps-operator/operator.sock'});
reject({OPERATOR_STATE_DIR:'/var/lib/gpt-vps-operator'});
reject({OPERATOR_KEY_FILE:'/home/ubuntu/.config/gpt-vps-operator/operator.private.json'});
reject({LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:'/etc/light-remote-direct/oauth-secret'},'plugin');
reject({LIGHT_REMOTE_PADDLE_STATE_FILE:'/var/lib/light-remote-direct/plugin-state/paddle-billing.json'},'plugin');
reject({LIGHT_REMOTE_MAIL_ENV_FILE:'/etc/light-remote-direct/mail.env'},'plugin');
reject({LIGHT_REMOTE_PADDLE_ENV:'live'},'plugin');
reject({OPERATOR_TEAM_INVITE_SECRET_FILE:'/etc/light-remote-direct/invite-key'});
reject({LIGHT_REMOTE_PLUGIN_HOST:'0.0.0.0'},'plugin');
reject({LIGHT_REMOTE_PLUGIN_ORIGIN:'https://light-remote.thaiduy.digital'},'plugin');
reject({LIGHT_REMOTE_GOLD_ROOT:'/'});
console.log('GOLD_RUNTIME_ISOLATION_FAIL_CLOSED_SOURCE_TEST_PASS');
