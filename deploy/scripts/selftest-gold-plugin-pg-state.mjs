import assert from 'node:assert/strict';
import { GoldRegistryPersistence } from '../../lib/gold-registry-persistence.mjs';
import { PaddleBilling } from '../../plugin-server/paddle-billing.mjs';
import { mountGoldGoogleAuth, saveGoogleAuthConfig, googleAuthStatus } from '../../plugin-server/google-auth.mjs';

const rows=new Map();
const pool={async query(sql,args=[]){
 if(sql.startsWith('SELECT domain,payload FROM lr_gold_registry_documents'))return {rows:[...rows].map(([domain,payload])=>({domain,payload:structuredClone(payload)}))};
 if(sql.startsWith('INSERT INTO lr_gold_registry_documents')){
  rows.set(args[0],JSON.parse(args[1]));return {rows:[],rowCount:1};
 }
 throw Error('unexpected_sql');
}};
const billing=new PaddleBilling({config:{environment:'sandbox',checkoutAllowed:false,apiKey:''}});
let store=await GoldRegistryPersistence.open({pool});
store.mount('paddle_billing',billing);
mountGoldGoogleAuth(store);
await store.flush();
billing.state.events['synthetic_event']={eventType:'synthetic',processedAt:1,result:{ok:true}};
billing._persist();
saveGoogleAuthConfig({clientId:'synthetic_testing_oauth_user.apps.googleusercontent.com',clientSecret:'synthetic_nonproduction_secret_12345'});
await store.flush();
assert.equal(rows.get('paddle_billing').state.events.synthetic_event.result.ok,true);
assert.equal(rows.get('google_oauth').config.clientSecret,'synthetic_nonproduction_secret_12345');
store=await GoldRegistryPersistence.open({pool});
store.mount('paddle_billing',billing);
mountGoldGoogleAuth(store);
await store.flush();
assert.ok(billing.state.events.synthetic_event);
assert.equal(googleAuthStatus().configured,true);
console.log('GOLD_PLUGIN_SYNTHETIC_PG_RESTART=PASS');
