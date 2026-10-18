import assert from 'node:assert/strict';
import {GoldNativeConnections} from '../../lib/gold-native-connections.mjs';
const records=new Map();
let sqlCount=0;
const query=async(sql,args=[])=>{
 sqlCount++;
 if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
 if(sql.startsWith('SELECT DISTINCT ON(device_id)')){
  return {rows:[...records.values()].filter(x=>x.registry_visible).map(x=>structuredClone(x))};
 }
 if(sql.startsWith('UPDATE lr_device_connections SET registry_visible=false')){
  for(const r of records.values())r.registry_visible=false;return {rowCount:records.size,rows:[]};
 }
 if(sql.startsWith('INSERT INTO lr_device_connections')){
  const row={connection_id:args[0],account_id:args[1],device_id:args[2],plan:args[3],
   connected_at:args[4],hard_expires_at:args[5],reconnect_grace_ms:args[6],
   last_activity_at:args[7],closed_at:args[8],close_reason:args[9],
   plan_cap_ms:args[10],last_renewed_ms:args[11],registry_visible:true};
  records.set(row.connection_id,row);return {rows:[],rowCount:1};
 }
 throw Error('unhandled_sql:'+sql);
};
const pool={query,async connect(){return {query,release(){}}}};
let db=await GoldNativeConnections.open({pool});
const now=Date.now();
const con={connectionId:'dc_123',accountId:'owner',deviceId:'device',plan:'pro',
 planCapMs:86400000,connectedAt:now,hardExpiresAt:now+86400000,
 reconnectGraceMs:3600000,lastActivityAt:now,closedAt:null,closeReason:null};
await db.store.write(new Map([['device',con]]));
db=await GoldNativeConnections.open({pool});
assert.equal(db.rows.length,1);
assert.equal(db.rows[0][1].connectionId,'dc_123');
assert.equal(db.rows[0][1].hardExpiresAt,now+86400000);
await db.store.write(new Map());
db=await GoldNativeConnections.open({pool});
assert.equal(db.rows.length,0,'removal may not resurrect historical leases');
assert.ok(sqlCount>4);
console.log('GOLD_NATIVE_CONNECTION_SQL_FAKE=PASS');
