import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeRmWork,authorizeRmVideo} from './rmv2-work-authority.mjs';
const ctx={device:{deviceId:'device'},binding:{accountId:'account'},payload:{sessionId:'session',agentId:'agent'}};
function fixture(){
 const session={state:'active',deviceId:'device',accountId:'account',nodeId:'node'};
 const grant={grantId:'grant',agentId:'agent',accountId:'account',purpose:'device',expiresAt:9000,absoluteExpiresAt:9000};
 const connection={connectionId:'connection',hardExpiresAt:8000};let assertion;
 const deps={sessions:{get(id,agent){assert.equal(id,'session');assert.equal(agent,'agent');return session;}},accounts:{assertOperational(id){assert.equal(id,'account');}},requireDeviceConnection(){return connection;},targetRoute(){return {deviceId:'device',capabilities:['desktop','desktop-input']};},accessGrants:{activeGrantsForDevice(){return [grant];},assert(_id,args){assertion=args;return grant;}}};
 return {deps,session,grant,connection,get assertion(){return assertion;}};
}
test('only exact session/Agent/device/account/current connection authorize an input slice',()=>{
 const x=fixture(),r=authorizeRmWork(ctx,x.deps,1000);assert.equal(r.validForMs,1000);assert.equal(x.assertion.touch,false);assert.equal(x.assertion.agentId,'agent');
 x.connection.hardExpiresAt=1500;assert.equal(authorizeRmWork(ctx,x.deps,1000).validForMs,500);
});
test('revoked grants, guest grants, closed sessions, removed input capability and disabled account stop authority',()=>{
 for(const mutation of [x=>x.grant.agentId='foreign',x=>x.grant.purpose='pro-share-guest',x=>x.session.state='closed',x=>x.session.deviceId='other',x=>x.deps.targetRoute=()=>({deviceId:'device',capabilities:['desktop']}),x=>x.deps.accounts.assertOperational=()=>{throw Error('disabled');},x=>x.deps.accessGrants.assert=()=>{throw Error('revoked');}]){
  const x=fixture();mutation(x);assert.throws(()=>authorizeRmWork(ctx,x.deps,1000));
 }
});
test('absolute A/B expiry and connection expiry cannot be extended by work authorization',()=>{
 const x=fixture();x.grant.absoluteExpiresAt=999;assert.throws(()=>authorizeRmWork(ctx,x.deps,1000),/expired/);
 x.grant.absoluteExpiresAt=9000;x.connection.hardExpiresAt=0;assert.throws(()=>authorizeRmWork(ctx,x.deps,1000),/expired/);
});
test('video needs the same live A/B identity but observation alone does not grant or require input',()=>{
 const x=fixture();x.deps.targetRoute=()=>({deviceId:'device',capabilities:['desktop']});
 assert.equal(authorizeRmVideo(ctx,x.deps,1000).authorized,true);
 assert.throws(()=>authorizeRmWork(ctx,x.deps,1000),/capability/);
 assert.equal(x.assertion.touch,false);
 x.deps.accessGrants.assert=()=>{throw Error('revoked');};assert.throws(()=>authorizeRmVideo(ctx,x.deps,1000),/revoked/);
});
