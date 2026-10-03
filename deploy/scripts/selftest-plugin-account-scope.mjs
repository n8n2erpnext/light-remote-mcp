import assert from 'node:assert/strict';
import { handlePluginRoutes } from '../../operator-host/executor-routes-plugin.mjs';

class AccountError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const accountsMap=new Map([['acct-a',{accountId:'acct-a',plan:'free'}],['acct-b',{accountId:'acct-b',plan:'pro'}]]);
const sessionRows=new Map();
let closeCalls=0;
const deps={
  AccountError,
  accounts:{account(id){const row=accountsMap.get(String(id||''));if(!row)throw new AccountError('account_not_found',404);return {...row};}},
  targetRoute(nodeId,{accountId}){return {accountId,deviceId:accountId==='acct-a'?'dev-a':'dev-b',nodeId,sessionCeiling:5,mode:'outbound-leaf'};},
  sessions:{
    open(input){const row={accountId:input.accountId,deviceId:input.deviceId,nodeId:input.nodeId,sessionId:`sid-${input.accountId}`,agentId:input.agentId,state:'active'};sessionRows.set(row.sessionId,row);return {...row};},
    list(){return [...sessionRows.values()].map(v=>({...v}));},
    get(id,agentId){const row=sessionRows.get(id);if(!row)throw new Error('session_not_found');if(agentId&&row.agentId!==agentId)throw new Error('session_owner_mismatch');return {...row};},
    resume(id,agentId){return this.get(id,agentId);},
    hold(id,agentId){return {...this.get(id,agentId),state:'hold'};},
    close(id,agentId){closeCalls++;return {...this.get(id,agentId),state:'closed'};},
    touch(id,agentId){return this.get(id,agentId);}
  },
  readJson:async req=>req.body||{},
  sendJson(res,status,payload){res.status=status;res.payload=payload;res.headersSent=true;return payload;}
};
async function call(method,path,body=null){
  const u=new URL(path,'http://operator.local'),res={headersSent:false};
  const handled=await handlePluginRoutes({method,body},res,u,deps);
  return {res,handled};
}
let x=await call('GET','/v1/plugin/accounts/acct-a');
assert.equal(x.handled,false);
x=await call('POST','/v1/plugin/sessions/open',{accountId:'acct-a',nodeId:'node-a',agentId:'agent-aaaaaaaaaaaaaaaa',openId:'open-aaaaaaaaaaaaaaaa'});
assert.equal(x.res.payload.session.accountId,'acct-a');
await call('POST','/v1/plugin/sessions/open',{accountId:'acct-b',nodeId:'node-b',agentId:'agent-bbbbbbbbbbbbbbbb',openId:'open-bbbbbbbbbbbbbbbb'});
x=await call('GET','/v1/plugin/sessions?accountId=acct-a');
assert.deepEqual(x.res.payload.sessions.map(v=>v.accountId),['acct-a']);
x=await call('GET','/v1/plugin/sessions/sid-acct-a?accountId=acct-a&agentId=agent-aaaaaaaaaaaaaaaa');
assert.equal(x.res.payload.session.accountId,'acct-a');
await assert.rejects(()=>call('POST','/v1/plugin/sessions/sid-acct-a/close',{accountId:'acct-b',agentId:'agent-aaaaaaaaaaaaaaaa'}),e=>e instanceof AccountError&&e.status===403);
assert.equal(closeCalls,0);
x=await call('POST','/v1/plugin/sessions/sid-acct-a/close',{accountId:'acct-a',agentId:'agent-aaaaaaaaaaaaaaaa'});
assert.equal(x.res.payload.session.state,'closed');
assert.equal(closeCalls,1);
console.log('PLUGIN_ACCOUNT_SCOPE_SELFTEST=PASS');
