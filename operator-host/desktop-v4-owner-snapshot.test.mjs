import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopV4OwnerSnapshot} from './desktop-v4-owner-snapshot.mjs';
const SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const data=({verified=true,devices=null,sessions=null,grants=null}={})=>{
 const state={accountId:'owner',email:'owner@example.test',plan:'pro',
   status:'active',isOwner:true,emailVerified:true,passwordHash:'TOP_SECRET'};
 const actualDevices=devices??[
  {deviceId:'dev-a',accountId:'owner',deviceName:'Home Windows',os:'windows',state:'online',shortId:'R01KAP'},
  {deviceId:'dev-foreign',accountId:'other',state:'online'}];
 const actualSessions=sessions??[
  {sessionId:'s-1',accountId:'owner',deviceId:'dev-a',agentId:'agent-1',
    displayName:'Agent A',state:'active',createdAt:100,lastSeenAt:200,expiresAt:300,
    workspace:'/private/work',activeJobs:[]},
  {sessionId:'s-foreign',accountId:'other',deviceId:'dev-foreign',agentId:'a',
    state:'active',createdAt:100}];
 const actualGrants=grants??[{grantId:'dag_v2_abc',accountId:'owner',
  deviceId:'dev-a',agentId:'agent-1',purpose:'device',approvedAt:100,
  expiresAt:300,absoluteExpiresAt:400},
  {grantId:'dag_v2_guest',accountId:'guest',deviceId:'dev-a',
   agentId:'agent-guest',purpose:'pro-share-guest',approvedAt:100,expiresAt:300}];
 return createDesktopV4OwnerSnapshot({
  accounts:{desktopOwnerSessionActive:(a,s)=>verified&&a==='owner'&&s===SESSION,
    account:(id)=>({...state,accountId:id})},
  allDeviceViews:()=>actualDevices,sessions:{list:()=>actualSessions},
  accessGrants:{activeGrantsForDevice:()=>actualGrants},
  usage:{summary:()=>({currentMonth:'2026-11',toolCallsThisMonth:12,rawSecret:'NEVER',devices:[{deviceId:'dev-a',toolCalls:9,onlineMs:3600000,secret:'NEVER'},{deviceId:'dev-foreign',toolCalls:2,onlineMs:10}]})},
  planEntitlements:()=>({plan:'pro',toolCallLimit:500,rawSecret:'NEVER'}),
  now:()=>1234
 });
};
test('native Owner read model excludes foreign devices/Agent, secret fields and workspace',()=>{
 const result=data()({accountId:'owner',accountSessionId:SESSION});
 assert.equal(result.ok,true);
 assert.equal(result.devices.length,1);
 assert.equal(result.sessions.length,1);
 assert.equal(result.grants.length,1);
 assert.equal(result.account.email,'owner@example.test');
 assert.equal(result.usage.toolCallsThisMonth,12);
 assert.equal(result.usage.month,'2026-11');
 assert.deepEqual(result.usage.byDevice,[{deviceId:'dev-a',toolCalls:9,onlineMs:3600000}]);
 assert.ok(!JSON.stringify(result).includes('TOP_SECRET'));
 assert.ok(!JSON.stringify(result).includes('NEVER'));
 assert.ok(!JSON.stringify(result).includes('/private/work'));
 assert.ok(!JSON.stringify(result).includes('dev-foreign'));
});
test('invalid, wrong, revoked and expired Owner session fail closed',()=>{
 for(const value of [
  {accountId:'other',accountSessionId:SESSION},
  {accountId:'owner',accountSessionId:'acctsess_fake'},
  {accountId:'owner',accountSessionId:''}
 ])assert.throws(()=>data()(value));
 assert.throws(()=>data({verified:false})({accountId:'owner',accountSessionId:SESSION}));
});
test('grant and session list caps fail closed, not silent truncation',()=>{
 const mk=(n)=>new Array(n).fill(null).map((_,i)=>({deviceId:'d'+i,accountId:'owner',state:'online'}));
 assert.throws(()=>data({devices:mk(201)})({accountId:'owner',accountSessionId:SESSION}),/too_large/);
 const rows=new Array(201).fill(null).map((_,i)=>({accountId:'owner',sessionId:'s'+i,deviceId:'dev-a',state:'hold'}));
 assert.throws(()=>data({sessions:rows})({accountId:'owner',accountSessionId:SESSION}),/too_large/);
});
test('no writes, no close/revoke from read route',()=>{
 let queried=0;
 const result=data()({accountId:'owner',accountSessionId:SESSION});
 assert.equal(result.sessions[0].activeJobs,0);
 assert.equal(result.sessions[0].state,'active');
 assert.equal(result.grants[0].grantId,'dag_v2_abc');
 assert.equal(queried,0);
});
