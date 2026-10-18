import assert from 'node:assert/strict';
import {GoldRegistryPersistence} from '../../lib/gold-registry-persistence.mjs';
import {AccountRegistry} from '../../operator-host/account-registry.mjs';
import {DeviceRegistry} from '../../operator-host/device-registry.mjs';
import {ProTeamRegistry} from '../../operator-host/pro-team-registry.mjs';

const database=new Map(),sql=[];
const pool={async query(statement,args=[]){
 sql.push(statement);
 if(statement.startsWith('SELECT domain,payload FROM lr_gold_registry_documents'))
  return {rows:[...database].map(([domain,payload])=>({domain,payload:structuredClone(payload)}))};
 if(statement.startsWith('INSERT INTO lr_gold_registry_documents')){
  database.set(args[0],JSON.parse(args[1]));
  return {rowCount:1,rows:[]};
 }
 throw Error('unexpected_sql');
}};
const make=async()=>{
 const store=await GoldRegistryPersistence.open({pool});
 const accounts=store.mount('accounts',new AccountRegistry({stateFile:null}));
 const devices=store.mount('devices',new DeviceRegistry({stateFile:null}));
 const team=store.mount('pro_teams',new ProTeamRegistry({
  stateFile:null,planFor:()=> 'pro',accountActive:()=>true,emailFor:()=>null
 }));
 await store.flush();
 return {store,accounts,devices,team};
};
const first=await make();
const group=first.accounts.createGroup('Gold Postgres Only');
const dev=first.devices.enroll({accountId:'gold_account',deviceId:'gold_device',nodeId:'gold_node',
 publicIdentityKey:'synthetic_public_key',displayName:'Gold Test'});
assert.equal(dev.deviceId,'gold_device');
await first.store.flush();
assert.ok(sql.some(x=>x.startsWith('INSERT INTO lr_gold_registry_documents')));
assert.ok(database.get('accounts').groups.some(([k])=>k===group.groupId));
assert.ok(database.get('devices').devices.some(([k])=>k==='gold_device'));
const restarted=await make();
assert.ok(restarted.accounts.listGroups().some(x=>x.groupId===group.groupId));
assert.equal(restarted.devices.get('gold_device').deviceId,'gold_device');
assert.deepEqual([...database.keys()].sort(),['accounts','devices','pro_teams']);
console.log('GOLD_REGISTRY_SYNTHETIC_PG_RESTART=PASS');
