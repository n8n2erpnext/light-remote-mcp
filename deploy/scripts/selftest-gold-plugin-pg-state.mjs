import assert from 'node:assert/strict';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {PaddleBilling} from '../../plugin-server/paddle-billing.mjs';
import {initializeGoldGoogleAuth,saveGoogleAuthConfig,googleAuthStatus,initializeGoogleRedis,beginGoogleAuth} from '../../plugin-server/google-auth.mjs';

const state=new Map();
let googleRow=null;
const pool={async query(sql,args=[]){
 if(sql.startsWith('SELECT domain,payload FROM lr_gold_registry_documents'))
  return {rows:[...state].map(([domain,payload])=>({domain,payload:structuredClone(payload)}))};
 if(sql.startsWith('INSERT INTO lr_gold_registry_documents')){
  state.set(args[0],JSON.parse(args[1]));
  return {rows:[],rowCount:1};
 }
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
assert.equal(state.get('paddle_billing').state.events.synthetic_event.result.ok,true);
assert.equal(googleRow.client_secret,'synthetic_nonproduction_secret_12345');
store=await GoldRegistryPersistence.open({pool});
store.mount('paddle_billing',billing);
await initializeGoldGoogleAuth(pool);
await store.flush();
assert.ok(billing.state.events.synthetic_event);
assert.equal(googleAuthStatus().configured,true);
assert.equal(state.has('google_oauth'),false);
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
