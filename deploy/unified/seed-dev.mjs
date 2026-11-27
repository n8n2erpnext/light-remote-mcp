import fs from 'node:fs';
import {connectGoldStorage} from '../../lib/gold-db.mjs';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {AccountRegistry} from '../../operator-host/account-registry.mjs';
if(process.env.LR_UNIFIED_DISPOSABLE_DEV!=='1')throw Error('disposable_dev_required');
const storage=await connectGoldStorage();
try{
 const marker=(await storage.pool.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]?.marker;
 if(marker!==`lr-unified-fixture:${process.env.LR_UNIFIED_SOURCE_COMMIT}`)throw Error('fixture_marker_mismatch');
 const count=Number((await storage.pool.query('SELECT count(*) AS n FROM lr_accounts')).rows[0].n);
 if(count!==0)throw Error('seed_requires_empty_disposable_database');
 const persistence=await GoldRegistryPersistence.open({pool:storage.pool});
 const registry=persistence.mount('accounts',new AccountRegistry({bootstrapAccountId:'unified-dev-owner'}));
 const credentials=JSON.parse(fs.readFileSync('/state/fixture-credentials.json','utf8'));
 registry.register({...credentials.owner,plan:'pro'});
 registry.accounts.get('unified-dev-owner').emailVerified=true;
 registry.registerHosted(credentials.foreign,{issueSession:false});
 registry._persist();
 await persistence.flush();
 if(process.env.LR_UNIFIED_PRODUCTION_ORIGIN_TEST==='1'){
  const callback='https://light-remote.thaiduy.digital/account/google/callback';
  await storage.pool.query(`INSERT INTO lr_gold_google_oauth_config(singleton_id,client_id,client_secret,redirect_uri)
   VALUES(1,$1,$2,$3)`,['light-remote-fixture-only.apps.googleusercontent.com','fixture-only-google-client-secret',callback]);
 }
 console.log('fixture_accounts_seeded=2; synthetic_only=true');
}finally{await storage.close()}
