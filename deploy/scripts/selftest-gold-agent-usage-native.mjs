import assert from 'node:assert/strict';
import {GoldNativeAgentClients} from '../../lib/gold-native-agent-clients.mjs';
import {GoldNativeUsage} from '../../lib/gold-native-usage.mjs';
const tables={clients:new Map(),bindings:new Map(),usageAccounts:new Map(),usageMonths:new Map(),usageDevices:new Map(),usageOpen:new Map(),trackingSince:null};
const query=async(sql,a=[])=>{
 if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
 const SELECT={
  'SELECT * FROM lr_agent_clients':()=>[...tables.clients.values()],
  'SELECT * FROM lr_agent_bindings':()=>[...tables.bindings.values()],
  'SELECT tracking_since_ms FROM lr_gold_usage_config WHERE singleton_id=1':()=>tables.trackingSince===null?[]:[{tracking_since_ms:tables.trackingSince}],
  'SELECT account_id,last_tool_call_ms FROM lr_gold_usage_account':()=>[...tables.usageAccounts.values()],
  'SELECT * FROM lr_gold_usage_month':()=>[...tables.usageMonths.values()],
  'SELECT * FROM lr_gold_usage_device':()=>[...tables.usageDevices.values()],
  'SELECT * FROM lr_gold_usage_open_connection':()=>[...tables.usageOpen.values()]
 };
 if(SELECT[sql])return {rows:SELECT[sql]().map(x=>structuredClone(x))};
 if(sql.startsWith('INSERT INTO lr_agent_clients')){
  tables.clients.set(a[0],{client_session_id:a[0],account_id:a[1],agent_id:a[2],
   created_at:a[3],last_activity_at:a[4],expires_at:a[5],closed_at:a[6],
   close_reason:a[7],default_device_id:a[8]});return {rows:[]};
 }
 if(sql.startsWith('DELETE FROM lr_agent_bindings')){tables.bindings.clear();return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_agent_bindings')){
  tables.bindings.set(a[0]+':'+a[1],{client_session_id:a[0],device_id:a[1],grant_id:a[2],
   connection_id:a[3],pairing_request_id:a[4],bound_at:a[5],last_activity_at:a[6],
   working_context:a[7]==null?null:JSON.parse(a[7])});return {rows:[]};
 }
 if(sql.startsWith('DELETE FROM lr_agent_clients')){for(const id of [...tables.clients.keys()])if(!a[0].includes(id))tables.clients.delete(id);return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_usage_config')){tables.trackingSince=a[0];return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_usage_account')){tables.usageAccounts.set(a[0],{account_id:a[0],last_tool_call_ms:a[1]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_usage_month')){tables.usageMonths.set(a[0]+':'+a[1],{account_id:a[0],month_key:a[1],tool_calls:a[2],online_ms:a[3]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_usage_device')){tables.usageDevices.set(a[0]+':'+a[1]+':'+a[2],{account_id:a[0],month_key:a[1],device_id:a[2],tool_calls:a[3],online_ms:a[4]});return {rows:[]}};
 if(sql.startsWith('INSERT INTO lr_gold_usage_open_connection')){tables.usageOpen.set(a[0],{connection_id:a[0],account_id:a[1],device_id:a[2],opened_ms:a[3],last_accrued_ms:a[4],hard_expires_ms:a[5]});return {rows:[]}};
 if(sql.startsWith('DELETE FROM lr_gold_usage_open_connection')){for(const id of [...tables.usageOpen.keys()])if(!a[0].includes(id))tables.usageOpen.delete(id);return {rows:[]}};
 throw Error('unexpected_sql:'+sql.slice(0,130));
};
const pool={query,async connect(){return {query,release(){}}}};
const now=Date.now();
const agent=await GoldNativeAgentClients.open({pool});
await agent.store.write(new Map([['lrc_test',{clientSessionId:'lrc_test',accountId:'owner',agentId:'agent',
 createdAt:now,lastActivityAt:now,expiresAt:now+86400000,closedAt:null,closeReason:null,
 defaultDeviceId:'device',
 bindings:{device:{deviceId:'device',grantId:'grant',connectionId:'conn',pairingRequestId:'pair',
 boundAt:now,lastActivityAt:now,workingContext:{cwd:'/workspace'}}}
}]]));
const loaded=await GoldNativeAgentClients.open({pool});
assert.equal(loaded.rows[0][1].bindings.device.workingContext.cwd,'/workspace');
const usage=await GoldNativeUsage.open({pool});
await usage.store.write({trackingSince:now,accounts:{owner:{
 lastToolCallAt:now,months:{'2026-10':{toolCalls:10,onlineMs:3600000,
 devices:{device:{toolCalls:10,onlineMs:3600000}}}}
}},openConnections:[['conn',{connectionId:'conn',accountId:'owner',deviceId:'device',openedAt:now,
 lastAccruedAt:now,hardExpiresAt:now+3600000}]]});
const reloaded=await GoldNativeUsage.open({pool});
assert.equal(reloaded.data.accounts.owner.months['2026-10'].devices.device.toolCalls,10);
assert.equal(reloaded.data.openConnections[0][1].connectionId,'conn');
console.log('GOLD_NATIVE_AGENT_USAGE_SQL_FAKE=PASS');
