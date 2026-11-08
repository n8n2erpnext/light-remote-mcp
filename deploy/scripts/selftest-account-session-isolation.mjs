import assert from 'node:assert/strict';
import { SessionRegistry } from '../../operator-host/session-manager.mjs';

let now = 1_000_000;
const sessions = new SessionRegistry({ now:()=>now, accountId:'self-hosted-local', deviceId:'arm-local', nodeId:'arm' });
const agentId = 'agent-account-isolation-0001';
const a = sessions.open({ accountId:'acct-a', agentId, deviceId:'dev-shared', nodeId:'node-a', openId:'open-account-a-0001' });
const b = sessions.open({ accountId:'acct-b', agentId, deviceId:'dev-shared', nodeId:'node-b', openId:'open-account-b-0001' });
assert.notEqual(a.sessionId,b.sessionId);
assert.equal(a.accountId,'acct-a');
assert.equal(b.accountId,'acct-b');
assert.equal(sessions.get(a.sessionId,agentId).accountId,'acct-a');
assert.equal(sessions.get(b.sessionId,agentId).accountId,'acct-b');

const a2=sessions.open({ accountId:'acct-a', agentId, deviceId:'dev-shared', nodeId:'node-a', openId:'open-account-a-0002' });
assert.equal(a2.sessionId,a.sessionId);

const legacy=sessions.open({ agentId:'agent-account-isolation-0002', deviceId:'dev-legacy', nodeId:'node-legacy' });
assert.equal(legacy.accountId,'self-hosted-local');

console.log(JSON.stringify({ok:true,accountIsolation:true,legacyDefault:true,sessions:sessions.list().length},null,2));
