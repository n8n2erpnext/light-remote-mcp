import assert from 'node:assert/strict';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

let flushed=0,verified=0,updated=0,events=[];
const active=new Set(['filesystem','git','terminal']);
const grantable=['filesystem','git','terminal','docker','lxd','kubernetes'];
let approved=['filesystem','git','terminal'];
let revision=1;
const ctx={binding:{accountId:'acct_owner',deviceId:'dev_owner',trustedHost:false},
  device:{deviceId:'dev_owner',capabilities:[...active]},payload:{}};
const policy=()=>({deviceId:'dev_owner',accountId:'acct_owner',policyRevision:revision,approvedCapabilities:[...approved],grantableCapabilities:[...grantable]});
const env=()=>({policy:policy(),signature:'signed-policy-fixture',signer:{publicKey:'fixture'}});
const deps={
 readJson:async req=>req.payload,
 verifiedChannelContext:async (body,action)=>{verified++;assert.equal(action,body.action);return {...ctx,payload:body.data}},
 enrollments:{
   refreshDiscoveredCapabilities:({deviceId,accountId,capabilities})=>{assert.equal(deviceId,'dev_owner');assert.equal(accountId,'acct_owner');assert.deepEqual(capabilities,grantable);revision++;return {policy:policy(),addedCapabilities:['docker','lxd','kubernetes'],removedCapabilities:[]}},
   updatePolicy:({deviceId,accountId,approvedCapabilities})=>{assert.equal(deviceId,'dev_owner');assert.equal(accountId,'acct_owner');if(approvedCapabilities.some(c=>!grantable.includes(c)))throw Error('approved_capability_not_grantable');approved=[...approvedCapabilities];revision++;updated++;return policy()},
   policyEnvelope:env
 },
 accounts:{verifyCredentials:({email,password})=>{if(email!=='owner@example.com'||password!=='fixture-owner-password')throw Error('invalid_account_credentials');return {accountId:'acct_owner'};}},
 devices:{heartbeat:()=>{}},
 flushGoldRegistries:async()=>{flushed++},
 pushEvent:row=>events.push(row),
 sendJson:(res,status,data)=>{res.status=status;res.data=data;return data}
};
const call=async(action,data)=>{
 const res={};const req={method:'POST',payload:{action,data}};
 const output=await handleDeviceChannelRoutes(req,res,new URL('http://x/v1/device-channel/'+action),deps);
 return {res,output}
};
let x=await call('capabilities-refresh',{capabilities:grantable});
assert.equal(x.res.status,200);assert.equal(flushed,1);assert.equal(updated,0);assert.equal(x.output.change.addedCapabilities.length,3);
try{await call('capabilities-owner-approve',{email:'owner@example.com',password:'incorrect',approvedCapabilities:grantable}) ;assert.fail('weak password accepted')}catch(e){assert.equal(e.message,'invalid_account_credentials')}
assert.equal(updated,0);assert.equal(flushed,1);
x=await call('capabilities-owner-approve',{email:'owner@example.com',password:'fixture-owner-password',approvedCapabilities:grantable,policyProfile:'full'});
assert.equal(x.res.status,200);assert.equal(updated,1);assert.equal(flushed,2);
assert.deepEqual(x.res.data.policy.policy.approvedCapabilities,grantable);
assert.equal(events.filter(e=>e.type==='device_permissions_owner_approved').length,1);
console.log('GOLD_OWNER_PERMISSION_AUTH_PASS device_proof_gate,owner_credentials,account_scope,durable_pg_flush,approval_revision');
