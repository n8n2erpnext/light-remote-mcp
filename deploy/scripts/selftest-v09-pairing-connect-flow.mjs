import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DevicePairingRegistry } from '../../operator-host/device-pairing-registry.mjs';
import { DeviceAccessGrantRegistry } from '../../operator-host/device-access-grant-registry.mjs';
import { AgentClientRegistry } from '../../operator-host/agent-client-registry.mjs';
import { createPlusAuth } from '../../gateway/plus-auth.mjs';

const now=()=>Date.now(), events=[];
const pairing=new DevicePairingRegistry({emit:e=>events.push(e),now,ttlMs:3*60*1000});
const access=new DeviceAccessGrantRegistry({emit:e=>events.push(e),now});
const clients=new AgentClientRegistry({emit:e=>events.push(e),now,ttlMs:60*60*1000});
const connections=new Map([
  ['dev-a',{state:'connected',connectionId:'dc-a',hardExpiresAt:Date.now()+4*60*60*1000}],
  ['dev-b',{state:'connected',connectionId:'dc-b',hardExpiresAt:Date.now()+4*60*60*1000}]
]);
const devices=new Map([
  ['dev-a',{deviceId:'dev-a',nodeId:'amd',displayName:'VPS-AMD',state:'online'}],
  ['dev-b',{deviceId:'dev-b',nodeId:'win',displayName:'WINDOWS',state:'online'}]
]);
const accountId='acct-pairing-selftest',agentId='agent-pairing-flow-0001';
const key=crypto.randomBytes(32);
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const sign=(kind,payload)=>{const body=enc(payload),mac=crypto.createHmac('sha256',key).update(`${kind}:${body}`).digest('base64url');return `o1.${kind}.${body}.${mac}`;};
const verify=(kind,token)=>{const [p,k,b,m]=String(token||'').split('.');if(p!=='o1'||k!==kind||!b||!m)return null;const e=crypto.createHmac('sha256',key).update(`${kind}:${b}`).digest('base64url');if(e!==m)return null;const v=JSON.parse(Buffer.from(b,'base64url').toString());return !v.exp||v.exp>Date.now()?v:null;};
const wall={signOAuthToken:sign,verifyOAuthToken:verify};
const pairAccess=async({aCode,agentId:aid,label})=>{
  const paired=pairing.redeem(aCode,{connectionForDevice:id=>connections.get(id)}),connection=connections.get(paired.deviceId);
  return {access:access.request({accountId,deviceId:paired.deviceId,connectionId:paired.connectionId,connectionExpiresAt:connection.hardExpiresAt,agentId:aid,label,forceApproval:true,requestTtlMs:5*60*1000,pairingId:paired.pairingId})};
};
const pollAccess=async body=>({access:access.poll(body)});
const assertGrant=async id=>{const grant=access.assert(id,{touch:false}),device=devices.get(grant.deviceId);return {grant,device};};
const attachClient=async({clientSessionId,agentId:aid,grantId,pairingRequestId})=>{const grant=access.assert(grantId,{touch:false}),client=clients.attach({clientSessionId,accountId,agentId:aid,grant,pairingRequestId}),device=devices.get(grant.deviceId);return {client:{clientSessionId:client.clientSessionId,agentId:client.agentId,expiresAt:client.expiresAt},device};};
const listClientDevices=async(id,aid)=>{const client=clients.view(id,{agentId:aid,touch:true}),out=[];for(const b of client.bindings){try{access.assert(b.grantId,{deviceId:b.deviceId,connectionId:b.connectionId,touch:false});const c=connections.get(b.deviceId);if(!c||c.state!=='connected'||c.connectionId!==b.connectionId)throw new Error('binding_invalid');const d=devices.get(b.deviceId);out.push({deviceId:d.deviceId,name:d.displayName,state:d.state});}catch{clients.removeDevice(b.deviceId,'binding_invalid');}}return {devices:out};};
const resolveClientDevice=async({clientSessionId,agentId:aid,deviceId})=>{const b=clients.resolve(clientSessionId,{agentId:aid,deviceId});const grant=access.assert(b.grantId,{deviceId:b.deviceId,connectionId:b.connectionId});return {binding:b,grant,device:devices.get(deviceId),connection:connections.get(deviceId)};};
const plus=createPlusAuth(wall,{pairAccess,pollAccess,assertGrant,attachClient,listClientDevices,resolveClientDevice});
function response(){return {statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},type(){return this;},send(v){this.body=v;return this;},set(){return this;}};}
function requestWithClient(token,body={},query={}){return {body,query,get:name=>name==='x-light-client'?token:''};}

const a1=pairing.rotate({accountId,deviceId:'dev-a',connectionId:'dc-a',connectionExpiresAt:connections.get('dev-a').hardExpiresAt});
let r=response();await plus.connectBegin({body:{aCode:a1.code,agentId,label:'ChatGPT'}},r);
assert.equal(r.statusCode,201);assert.equal(r.body.status,'approval_required');assert.match(r.body.code,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);assert.ok(r.body.continuation.startsWith('o1.pair.'));
assert.ok(JSON.stringify(r.body).length<1000,'connect response must remain compact');
const b1=r.body.code,cont1=r.body.continuation,ctx1=verify('pair',cont1);
r=response();await plus.connectPoll({body:{continuation:cont1}},r);assert.equal(r.statusCode,202);assert.equal(r.body.status,'approval_required');
r=response();await plus.connectBegin({body:{aCode:a1.code,agentId,label:'replay'}},r);assert.equal(r.body.status,'need_a_code');
assert.throws(()=>access.approve(ctx1.requestId,{deviceId:'dev-b',connectionId:'dc-b',connectionExpiresAt:connections.get('dev-b').hardExpiresAt}),/device_access_request_device_mismatch/);
access.approve(ctx1.requestId,{deviceId:'dev-a',connectionId:'dc-a',connectionExpiresAt:connections.get('dev-a').hardExpiresAt,idleGraceMs:30*60*1000});
r=response();await plus.connectPoll({body:{continuation:cont1}},r);assert.equal(r.statusCode,200);assert.equal(r.body.status,'ready');assert.equal(r.body.device,'VPS-AMD');const client1=r.body.client;assert.ok(client1.startsWith('o1.client.'));assert.ok(JSON.stringify(r.body).length<1000);
r=response();await plus.connectPoll({body:{continuation:cont1}},r);assert.equal(r.statusCode,200);assert.equal(verify('client',r.body.client).clientSessionId,verify('client',client1).clientSessionId,'ready poll retry must be idempotent');
let next=false,req=requestWithClient(client1);r=response();await plus.requireClient(req,r,()=>{next=true;});assert.ok(next);r=response();await plus.listDevices(req,r);assert.deepEqual(r.body.devices.map(x=>x.id),['dev-a']);

const a2=pairing.rotate({accountId,deviceId:'dev-b',connectionId:'dc-b',connectionExpiresAt:connections.get('dev-b').hardExpiresAt});
r=response();await plus.connectBegin({body:{aCode:a2.code,agentId,label:'ChatGPT',client:client1}},r);assert.equal(r.statusCode,201);const b2=r.body.code,cont2=r.body.continuation,ctx2=verify('pair',cont2);access.approve(ctx2.requestId,{deviceId:'dev-b',connectionId:'dc-b',connectionExpiresAt:connections.get('dev-b').hardExpiresAt,idleGraceMs:30*60*1000});
r=response();await plus.connectPoll({body:{continuation:cont2}},r);assert.equal(r.statusCode,200);const client2=r.body.client;req=requestWithClient(client2);next=false;r=response();await plus.requireClient(req,r,()=>{next=true;});assert.ok(next);r=response();await plus.listDevices(req,r);assert.deepEqual(r.body.devices.map(x=>x.id).sort(),['dev-a','dev-b']);
const cctx=verify('client',client2);assert.equal(cctx.clientSessionId,verify('client',client1).clientSessionId,'second pairing must extend the same client session');

const resolveReq=requestWithClient(client2,{deviceId:'dev-b'});next=false;r=response();await plus.requireClient(resolveReq,r,()=>{next=true;});assert.ok(next);next=false;r=response();await plus.requireClientDevice(resolveReq,r,()=>{next=true;});assert.ok(next);assert.equal(resolveReq.plusClientDevice.grant.deviceId,'dev-b');
connections.get('dev-a').state='dormant';access.closeByDevice('dev-a','disconnect');clients.removeDevice('dev-a','disconnect');
req=requestWithClient(client2);next=false;r=response();await plus.requireClient(req,r,()=>{next=true;});assert.ok(next);r=response();await plus.listDevices(req,r);assert.deepEqual(r.body.devices.map(x=>x.id),['dev-b']);

const logged=JSON.stringify(events);assert.ok(!logged.includes(a1.code)&&!logged.includes(a2.code)&&!logged.includes(b1)&&!logged.includes(b2),'A/B plaintext must not enter activity events');
console.log('v09-pairing-connect-a-to-b=PASS');
console.log('v09-pairing-connect-b-wrong-device=PASS');
console.log('v09-pairing-connect-a-replay=PASS');
console.log('v09-pairing-connect-multi-device-client=PASS');
console.log('v09-pairing-connect-disconnect-isolation=PASS');
console.log('v09-pairing-connect-compact-response=PASS');
console.log('v09-pairing-connect-poll-idempotent=PASS');
