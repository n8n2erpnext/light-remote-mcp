import assert from 'node:assert/strict';
import {GoldNativeAgentClients} from '../../lib/gold-native-agent-clients.mjs';
// Regression: RC50 lr_agent_bindings.account_id is NOT NULL and participates
// in tenant/actor-and-device composite foreign keys.
const queries=[];
const client={query:async(sql,values=[])=>{queries.push({sql,values});return {rows:[]}},release:()=>{}};
const pool={query:client.query,connect:async()=>client};
const id='lrc_gold_fixture',accountId='acct_gold_fixture',deviceId='dev_gold_fixture';
const now=Date.now();
await new GoldNativeAgentClients({pool}).write(new Map([[id,{
  clientSessionId:id,accountId,agentId:'uat-agent',
  createdAt:now,lastActivityAt:now,expiresAt:now+60000,
  bindings:{[deviceId]:{
    deviceId,grantId:'dag_gold_fixture',connectionId:'conn_gold_fixture',
    pairingRequestId:'pa_gold_fixture',boundAt:now,lastActivityAt:now,
    workingContext:{sessionId:'s_gold_fixture',workspace:'/tmp'}
  }}
}]]));
const binding=queries.find(q=>q.sql.includes('INSERT INTO lr_agent_bindings'));
assert.ok(binding,'binding insert was not sent');
assert.match(binding.sql,/\baccount_id\b/,'missing tenant owner column');
assert.match(binding.sql,/\$10::jsonb/,'working context parameter shifted');
assert.match(binding.sql,/\bgrant_purpose\b/,'guest grant purpose not persisted');
assert.equal(binding.values[0],id);
assert.equal(binding.values[7],accountId,'tenant actor not mapped');
assert.equal(binding.values[8],'device','owner binding purpose must default to device');
assert.equal(JSON.parse(binding.values[9]).sessionId,'s_gold_fixture');
assert.deepEqual(queries.map(q=>q.sql.trim().split(/\s+/)[0]),['BEGIN','INSERT','DELETE','INSERT','DELETE','COMMIT']);
console.log('GOLD_AGENT_CLIENT_TENANT_BINDING_INSERT=PASS');

// Candidate guest uses actor account in native AgentClient, distinct from
// device owner; the SQL composite FK (and PG044 CHECK) enforce grant purpose.
queries.length=0;
const guestRow={clientSessionId:'lrc_guest',accountId:'guest-acct',
 agentId:'guest-agent',createdAt:now,lastActivityAt:now,expiresAt:now+60000,
 bindings:{[deviceId]:{deviceId,grantId:'dag_guest',
  grantPurpose:'pro-share-guest',connectionId:'conn_gold_fixture',
  boundAt:now,lastActivityAt:now}}};
await new GoldNativeAgentClients({pool}).write(new Map([['lrc_guest',guestRow]]));
const guestInsert=queries.find(q=>q.sql.includes('INSERT INTO lr_agent_bindings'));
assert.equal(guestInsert.values[7],'guest-acct');
assert.equal(guestInsert.values[8],'pro-share-guest');
console.log('GOLD_NATIVE_AGENT_CLIENT_GUEST_PURPOSE_PERSISTENCE=PASS');
