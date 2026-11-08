import assert from 'node:assert/strict';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {PaddleBilling} from '../../plugin-server/paddle-billing.mjs';
import {initializeGoldGoogleAuth,saveGoogleAuthConfig,googleAuthStatus,initializeGoogleRedis,beginGoogleAuth} from '../../plugin-server/google-auth.mjs';

const paddleEvents=new Map(),paddleSubscriptions=new Map(),paddleRefunds=new Map();
let googleRow=null;
const pool={async connect(){return {query:this.query.bind(this),release(){}}},async query(sql,args=[]){
 if(sql.startsWith('SELECT team_id,owner_account_id,created_at FROM lr_teams')||
 sql.startsWith('SELECT team_id,account_id FROM lr_team_members')||
 sql.startsWith('SELECT team_id,device_id FROM lr_gold_team_shared_devices')||
 sql.startsWith('SELECT * FROM lr_gold_team_entitlements')||
 sql.startsWith('SELECT * FROM lr_gold_team_invite_codes')||
 sql.startsWith('SELECT * FROM lr_gold_team_notification_reads')||
 sql.startsWith('SELECT owner_account_id,member_email,issued_ms FROM lr_gold_team_email_invite_events')||
 sql.startsWith('SELECT * FROM lr_gold_license_keys')||
 sql.startsWith('SELECT license_id,account_id,redeemed_ms FROM lr_gold_license_redemptions')||
 sql.startsWith('SELECT DISTINCT ON(device_id) * FROM lr_device_connections')||
 sql.startsWith('SELECT * FROM lr_gold_support_outbox')||
 sql.startsWith('SELECT * FROM lr_ab_requests')||
 sql.startsWith('SELECT * FROM lr_ab_grants')||
 sql.startsWith('SELECT * FROM lr_gold_ab_request_metadata')||
 sql.startsWith('SELECT * FROM lr_gold_ab_grant_metadata')||
 sql.startsWith('SELECT * FROM lr_gold_enrollment_pending')||
 sql.startsWith('SELECT * FROM lr_gold_enrollment_bindings')||
 sql.startsWith('SELECT * FROM lr_agent_clients')||
 sql.startsWith('SELECT * FROM lr_agent_bindings')||
 sql.startsWith('SELECT tracking_since_ms FROM lr_gold_usage_config')||
 sql.startsWith('SELECT account_id,last_tool_call_ms FROM lr_gold_usage_account')||
 sql.startsWith('SELECT * FROM lr_gold_usage_month')||
 sql.startsWith('SELECT * FROM lr_gold_usage_device')||
 sql.startsWith('SELECT * FROM lr_gold_usage_open_connection'))return {rows:[]};
 if(sql.startsWith('SELECT * FROM lr_gold_paddle_events'))return {rows:[...paddleEvents.values()]};
 if(sql.startsWith('SELECT * FROM lr_gold_paddle_subscriptions'))return {rows:[...paddleSubscriptions.values()]};
 if(sql.startsWith('SELECT * FROM lr_gold_paddle_refunds'))return {rows:[...paddleRefunds.values()]};
 if(sql.startsWith('INSERT INTO lr_gold_paddle_events')){paddleEvents.set(args[0],{event_id:args[0],event_type:args[1],processed_ms:args[2],result:JSON.parse(args[3])});return {rows:[]};}
 if(sql.startsWith('INSERT INTO lr_gold_paddle_subscriptions')){paddleSubscriptions.set(args[0],{subscription_id:args[0],account_id:args[1],status:args[2],event_type:args[3],updated_ms:args[4]});return {rows:[]};}
 if(sql.startsWith('INSERT INTO lr_gold_paddle_refunds')){paddleRefunds.set(args[0],{adjustment_id:args[0],transaction_id:args[1],account_id:args[2],subscription_id:args[3],status:args[4],requested_by:args[5],reason:args[6],requested_ms:args[7],updated_ms:args[8],result:JSON.parse(args[9])});return {rows:[]};}
 if(sql.startsWith('DELETE FROM lr_gold_paddle_events')){for(const id of [...paddleEvents.keys()])if(!args[0].includes(id))paddleEvents.delete(id);return {rows:[]};}
 if(sql.startsWith('DELETE FROM lr_gold_paddle_subscriptions')){for(const id of [...paddleSubscriptions.keys()])if(!args[0].includes(id))paddleSubscriptions.delete(id);return {rows:[]};}
 if(sql.startsWith('DELETE FROM lr_gold_paddle_refunds')){for(const id of [...paddleRefunds.keys()])if(!args[0].includes(id))paddleRefunds.delete(id);return {rows:[]};}
 if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rows:[]};
 if(sql.startsWith('SELECT * FROM lr_accounts')||sql.startsWith('SELECT * FROM lr_devices')||sql.startsWith('SELECT * FROM lr_gold_account_entitlements')||sql.startsWith('SELECT * FROM lr_gold_fleet_provisioning'))return {rows:[]};
 if(sql.startsWith('DELETE FROM lr_teams')||sql.startsWith('INSERT INTO lr_teams')||sql.startsWith('DELETE FROM lr_gold_team_')||sql.startsWith('DELETE FROM lr_team_')||
    sql.startsWith('INSERT INTO lr_gold_team_')||sql.startsWith('INSERT INTO lr_team_')||
    sql.startsWith('DELETE FROM lr_gold_license_')||sql.startsWith('INSERT INTO lr_gold_license_'))
   return {rows:[],rowCount:1};
 if(/^SELECT \* FROM (lr_sessions|lr_gold_account_one_time_tokens|lr_gold_account_upgrade_requests|lr_gold_pending_registrations|lr_gold_google_signup_intents|lr_gold_account_groups)$/.test(sql))return {rows:[]};
 if(sql.startsWith('SELECT client_id,client_secret,redirect_uri FROM lr_gold_google_oauth_config'))
  return {rows:googleRow?[structuredClone(googleRow)]:[]};
 if(sql.startsWith('INSERT INTO lr_gold_google_oauth_config')){
  googleRow={client_id:args[0],client_secret:args[1],redirect_uri:args[2]};
  return {rows:[],rowCount:1};
 }
 throw Error('unexpected_sql:'+sql);
}};
const billing=new PaddleBilling({config:{environment:'sandbox',checkoutAllowed:false,apiKey:''}});
let store=await GoldRegistryPersistence.open({pool});
store.mount('paddle_billing',billing);
await initializeGoldGoogleAuth(pool);
await store.flush();
billing.state.events.synthetic_event={eventType:'synthetic',processedAt:1,result:{ok:true}};
billing._persist();
await saveGoogleAuthConfig({
 clientId:'synthetic_testing_oauth_user.apps.googleusercontent.com',
 clientSecret:'synthetic_nonproduction_secret_12345'
});
await store.flush();
assert.equal(paddleEvents.get('synthetic_event').result.ok,true);

assert.equal(googleRow.client_secret,'synthetic_nonproduction_secret_12345');
store=await GoldRegistryPersistence.open({pool});
store.mount('paddle_billing',billing);
await initializeGoldGoogleAuth(pool);
await store.flush();
assert.ok(billing.state.events.synthetic_event);
assert.equal(googleAuthStatus().configured,true);

const redisKeys=new Map();
initializeGoogleRedis({
 async set(key,value,{EX,NX}={}){assert.equal(EX,600);assert.equal(NX,true);if(redisKeys.has(key))return null;redisKeys.set(key,value);return 'OK'},
 async getDel(key){const value=redisKeys.get(key)??null;redisKeys.delete(key);return value}
},'lr:gold:synthetic:');
const login=await beginGoogleAuth({returnTo:'/account'});
const parsed=new URL(login.url);
assert.equal(parsed.hostname,'accounts.google.com');
assert.ok(parsed.searchParams.get('state'));
assert.equal(redisKeys.size,1);
console.log('GOLD_PLUGIN_NATIVE_GOOGLE_PG_RESTART=PASS');
console.log('GOLD_GOOGLE_REDIS_FLOW_FAKE=PASS');
