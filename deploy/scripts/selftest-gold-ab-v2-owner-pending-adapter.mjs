// P2-I2c source-only negative authority tests; NO network/Redis/device writes.
import assert from 'node:assert/strict';
import {GoldAbV2OwnerPendingAdapter} from '../../lib/gold-ab-v2-owner-pending-adapter.mjs';
const calls=[];
const pending={
 listDevicePending:async args=>{calls.push(['list',args]);return [{requestId:'av2_test',state:'pending',attempt:1,
  expiresAt:1900000000000,aCode:'ABCD02-GHFDX',requester:'owner1',box:{secret:'B-SECRET'},bCode:'SHOULD-NOT-LEAK'}];},
 wallView:async args=>{calls.push(['view',args]);return {requestId:args.requestId,state:'pending',
  attempt:2,expiresAt:1900000000000,aCode:'ABCD02-ABCDE',bCode:'SHOULD-NOT-LEAK'};},
 refresh:async args=>{calls.push(['refresh',args]);return {requestId:args.requestId,state:'pending',attempt:3,expiresAt:1900000300000,bCode:'SHOULD-NOT-LEAK'};},
 deny:async args=>{calls.push(['deny',args]);return {requestId:args.requestId,state:'denied',bCode:'SHOULD-NOT-LEAK'};}
};
const sessions=new Map([['ok',{account:{accountId:'owner1',status:'active'}}],
 ['other',{account:{accountId:'owner2',status:'active'}}],['inactive',{account:{accountId:'owner1',status:'disabled'}}]]);
const devices=new Map([['dev1',{deviceId:'dev1',accountId:'owner1',state:'online'}],
 ['dev2',{deviceId:'dev2',accountId:'owner2',state:'online'}],
 ['revoked',{deviceId:'revoked',accountId:'owner1',state:'revoked'}]]);
let connection={deviceId:'dev1',accountId:'owner1',connectionId:'conn1',state:'connected',
 hardExpiresAt:Date.now()+600000};
let policy=true,enrolled=true,enabled=true;
const app=new GoldAbV2OwnerPendingAdapter({pending,
 authenticateOwner:async req=>sessions.get(req.verifiedSession)||null,
 getDevice:async id=>devices.get(id)||null,
 getConnection:async id=>id==='dev1'?connection:null,
 verifyEnrolledConnection:async()=>enrolled,
 authorizeOwnerAction:async()=>policy,
 isFeatureEnabled:async()=>enabled,
 verifyOwnerMutation:async ctx=>ctx.request.csrfApproved===true && ctx.request.originApproved===true});
const req=(session='ok',extra={})=>({verifiedSession:session,csrfApproved:true,originApproved:true,
 body:{ownerAccountId:'owner2',connectionId:'evil',agentId:'evil'},...extra});
const list=await app.list(req(),{deviceId:'dev1'});
assert.equal(list.pending.length,1);
assert.equal(list.pending[0].aCode,'ABCD02-GHFDX');
assert.ok(!JSON.stringify(list).includes('SHOULD-NOT-LEAK'));
assert.deepEqual(calls.at(-1)[1],{ownerAccountId:'owner1',deviceId:'dev1',connectionId:'conn1',limit:5},
 'fake body identity never enters Redis');
assert.equal((await app.view(req(),{deviceId:'dev1',requestId:'av2_test'})).attempt,2);
assert.equal((await app.refresh(req(),{deviceId:'dev1',requestId:'av2_test',expectedAttempt:2})).attempt,3);
assert.equal((await app.deny(req(),{deviceId:'dev1',requestId:'av2_test'})).state,'denied');
for(const [payload,pattern] of [
 [()=>app.list(req('other'),{deviceId:'dev1'}),/abv2_owner_device_denied/],
 [()=>app.list(req('ok'),{deviceId:'dev2'}),/abv2_owner_device_denied/],
 [()=>app.list(req('ok'),{deviceId:'revoked'}),/abv2_owner_device_denied/],
 [()=>app.list(req('inactive'),{deviceId:'dev1'}),/abv2_owner_inactive/],
 [()=>app.list(req('missing'),{deviceId:'dev1'}),/abv2_owner_session_required/],
 [()=>app.refresh(req('ok',{csrfApproved:false}),{deviceId:'dev1',requestId:'av2_test',expectedAttempt:2}),/abv2_owner_mutation_denied/],
 [()=>app.deny(req('ok',{originApproved:false}),{deviceId:'dev1',requestId:'av2_test'}),/abv2_owner_mutation_denied/],
 [()=>app.list(req(),{deviceId:'dev1',limit:50}),/abv2_index_limit_invalid/],
 ])await assert.rejects(payload(),pattern);
enrolled=false;
await assert.rejects(app.list(req(),{deviceId:'dev1'}),/abv2_enrollment_denied/);
enrolled=true;policy=false;
await assert.rejects(app.list(req(),{deviceId:'dev1'}),/abv2_owner_policy_denied/);
policy=true;enabled=false;
await assert.rejects(app.list(req(),{deviceId:'dev1'}),/abv2_owner_pending_disabled/);
enabled=true;connection={...connection,connectionId:'conn-stale',hardExpiresAt:Date.now()-1};
await assert.rejects(app.list(req(),{deviceId:'dev1'}),/abv2_device_connection_invalid/);
connection={...connection,hardExpiresAt:Date.now()+600000};
const revised=await app.list(req(),{deviceId:'dev1'});
assert.equal(revised.connectionId,'conn-stale');
assert.equal(calls.at(-1)[1].connectionId,'conn-stale','never fall back to old connection');
assert.equal(typeof app.approve,'undefined','no Redis-approved-to-grant bypass');
const off=new GoldAbV2OwnerPendingAdapter({pending,authenticateOwner:async r=>sessions.get(r.verifiedSession),
 getDevice:async id=>devices.get(id),getConnection:async()=>connection,
 verifyEnrolledConnection:async()=>true,authorizeOwnerAction:async()=>true,verifyOwnerMutation:async()=>true});
await assert.rejects(off.list(req(),{deviceId:'dev1'}),/abv2_owner_pending_disabled/);
console.log('GOLD_ABV2_OWNER_PENDING_AUTH_SCOPE_CSRF_NO_GRANT=PASS');
