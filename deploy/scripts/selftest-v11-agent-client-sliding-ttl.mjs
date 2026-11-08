import fs from 'node:fs';
import assert from 'node:assert/strict';
import {AgentClientRegistry,AgentClientRegistryError} from '../../operator-host/agent-client-registry.mjs';

const ttl=15*60*1000;
let now=1_000_000;
const file='/tmp/lrm-agent-client-sliding-ttl-'+process.pid+'.json';
fs.rmSync(file,{force:true});
const events=[];
const reg=new AgentClientRegistry({stateFile:file,now:()=>now,ttlMs:ttl,emit:e=>events.push(e)});
const grant={grantId:'dag_sliding_0001',deviceId:'dev-sliding',connectionId:'dc-sliding'};
const client=reg.attach({accountId:'acct-sliding',agentId:'agent-sliding',grant});
const originalExpiry=client.expiresAt;
assert.equal(originalExpiry,now+ttl);

now=originalExpiry-1000;
const touched=reg.findActive({accountId:'acct-sliding',agentId:'agent-sliding',touch:true});
assert.equal(touched.lastActivityAt,now);
assert.equal(touched.expiresAt,now+ttl);
assert.ok(touched.expiresAt>originalExpiry);

now=originalExpiry+1000;
assert.equal(reg.reap(),0,'active client must survive beyond original hard expiry after touch');
const beyondOriginal=reg.view(client.clientSessionId,{agentId:'agent-sliding'});
assert.equal(beyondOriginal.closedAt,null);
assert.ok(beyondOriginal.expiresAt>now);

const beforeResolveExpiry=beyondOriginal.expiresAt;
now+=30_000;
const binding=reg.resolve(client.clientSessionId,{agentId:'agent-sliding',deviceId:'dev-sliding',touch:true});
assert.equal(binding.deviceId,'dev-sliding');
const afterResolve=reg.view(client.clientSessionId,{agentId:'agent-sliding'});
assert.equal(afterResolve.lastActivityAt,now);
assert.equal(afterResolve.expiresAt,now+ttl);
assert.ok(afterResolve.expiresAt>beforeResolveExpiry);

reg.rows.clear();
const reloaded=reg.view(client.clientSessionId,{agentId:'agent-sliding'});
assert.equal(reloaded.expiresAt,afterResolve.expiresAt,'renewed expiry must persist to disk');

now=afterResolve.expiresAt+1;
assert.equal(reg.reap(),1,'inactive client must still expire after one full TTL without activity');
assert.throws(
  ()=>reg.view(client.clientSessionId,{agentId:'agent-sliding'}),
  e=>e instanceof AgentClientRegistryError && e.message==='agent_client_required' && e.status===401
);
assert.ok(events.some(e=>e.type==='agent_client_closed'&&e.reason==='expired'));

fs.rmSync(file,{force:true});
console.log('v11-agent-client-sliding-ttl=PASS');
