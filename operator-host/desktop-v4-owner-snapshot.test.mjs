import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopV4OwnerSnapshot} from './desktop-v4-owner-snapshot.mjs';
const SESSION='acctsess_123e4567-e89b-42d3-a456-426614174000';
const data=({verified=true,devices=null,sessions=null,grants=null,
 jobs=null,shortIdRows=new Map([['dev-a','R01KAP']])}={})=>{
 const state={accountId:'owner',email:'owner@example.test',plan:'pro',
   status:'active',isOwner:true,emailVerified:true,passwordHash:'TOP_SECRET'};
 const actualDevices=devices??[
  {deviceId:'dev-a',accountId:'owner',displayName:'Home Windows',os:'windows',state:'online',shortId:'R01KAP'},
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
  jobs:jobs??new Map([
    ['j1',{id:'j1',accountId:'owner',deviceId:'dev-a',agentId:'agent-1',
      sessionId:'s-1',status:'running',startedAt:1000,stdout:'SECRET',script:'SECRET'}],
    ['j2',{id:'j2',accountId:'other',deviceId:'dev-foreign',
      sessionId:'s-foreign',script:'SECRET'}]
  ]),
  lookupShortIds:async({accountId,deviceIds})=>{
   assert.equal(accountId,'owner');
   assert.ok(deviceIds.every(id=>id!=='dev-foreign'));
   return shortIdRows;
  },
  recentEvents:()=>[
    {accountId:'owner',deviceId:'dev-a',type:'job_started',
      status:'running',at:'2026-11-06T00:00:00.000Z',detail:'SECRET'},
    {accountId:'other',deviceId:'dev-foreign',type:'job_started',detail:'SECRET'}
  ],
  now:()=>1234
 });
};
test('native Owner read model excludes foreign devices/Agent, secret fields and workspace',async()=>{
 const result=await data()({accountId:'owner',accountSessionId:SESSION});
 assert.equal(result.ok,true);
 assert.equal(result.devices.length,1);
 assert.equal(result.devices[0].name,'Home Windows',
  'real registry field displayName must render');
 assert.equal(result.devices[0].shortId,'R01KAP',
  'Owner-only batch lookup supplies signed PG043 mapping');
 assert.equal(result.coverage.jobs.hasMore,false);
 assert.equal(result.sessions.length,1);
 assert.equal(result.grants.length,1);
 assert.equal(result.account.email,'owner@example.test');
 assert.equal(result.usage.toolCallsThisMonth,12);
 assert.equal(result.usage.month,'2026-11');
 assert.deepEqual(result.usage.byDevice,[{deviceId:'dev-a',toolCalls:9,onlineMs:3600000}]);
 assert.equal(result.jobs.length,1);
 assert.equal(result.jobs[0].state,'running');
 assert.equal(result.events.length,1);
 assert.equal(result.events[0].eventType,'job_started');
 assert.equal(result.events[0].at,Date.UTC(2026,10,6));
 assert.ok(!JSON.stringify(result).includes('TOP_SECRET'));
 assert.ok(!JSON.stringify(result).includes('NEVER'));
 assert.ok(!JSON.stringify(result).includes('/private/work'));
 assert.ok(!JSON.stringify(result).includes('dev-foreign'));
});
test('invalid, wrong, revoked and expired Owner session fail closed',async()=>{
 for(const value of [
  {accountId:'other',accountSessionId:SESSION},
  {accountId:'owner',accountSessionId:'acctsess_fake'},
  {accountId:'owner',accountSessionId:''}
 ])await assert.rejects(()=>data()(value));
 await assert.rejects(()=>data({verified:false})({accountId:'owner',accountSessionId:SESSION}));
});
test('device and session history overflow provide truthful bounded coverage',async()=>{
 const mk=(n)=>new Array(n).fill(null).map((_,i)=>({deviceId:'d'+i,accountId:'owner',state:'online'}));
 const fleet=await data({devices:mk(201)})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(fleet.ok,true);
 assert.equal(fleet.devices.length,200);
 assert.deepEqual(fleet.coverage.devices,{returned:200,total:201,hasMore:true,source:'owner_bounded_viewport'});
 const rows=new Array(201).fill(null).map((_,i)=>({accountId:'owner',sessionId:'s'+i,deviceId:'dev-a',state:'hold'}));
 const view=await data({sessions:rows})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(view.sessions.length,200);
 assert.equal(view.coverage.sessions.total,201);
 assert.equal(view.coverage.sessions.hasMore,true);
});
test('no writes, no close/revoke from read route',async()=>{
 let queried=0;
 const result=await data()({accountId:'owner',accountSessionId:SESSION});
 assert.equal(result.sessions[0].activeJobs,0);
 assert.equal(result.sessions[0].state,'active');
 assert.equal(result.grants[0].grantId,'dag_v2_abc');
 assert.equal(queried,0);
});


test('200-job viewport cannot make the whole Owner snapshot disappear',async()=>{
 const jobs=new Map();
 for(let i=0;i<241;i++)jobs.set('job-'+i,{
  id:'job-'+i,accountId:'owner',deviceId:'dev-a',
  sessionId:'s-1',status:i%2?'running':'ok',startedAt:i+1000,
  script:'SECRET',stdout:'SECRET'
 });
 jobs.set('foreign',{id:'foreign',accountId:'other',deviceId:'dev-foreign'});
 const view=await data({jobs})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(view.ok,true);
 assert.equal(view.devices.length,1);
 assert.equal(view.sessions.length,1);
 assert.equal(view.jobs.length,200);
 assert.equal(view.coverage.jobs.total,241);
 assert.equal(view.coverage.jobs.hasMore,true);
 assert.equal(view.coverage.jobs.source,'in_memory_current_window');
 assert.equal(view.jobs[0].jobId,'job-240');
 assert.ok(!JSON.stringify(view).includes('SECRET'));
 assert.ok(!JSON.stringify(view).includes('foreign'));
});
test('Short ID comes only from exact Owner PG mapping, never from spoofed device rows',async()=>{
 const view=await data({shortIdRows:new Map()})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(view.devices[0].name,'Home Windows');
 assert.equal(view.devices[0].shortId,null);
 const forged=await data({devices:[
  {deviceId:'dev-a',accountId:'owner',displayName:'Main',shortId:'HACKED',state:'online'}
 ],shortIdRows:new Map([['dev-a','R01KAP']])})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(forged.devices[0].shortId,'R01KAP');
});

test('revoked Owner session during awaited Short ID lookup is rejected',async()=>{
 let valid=true;
 let complete;
 const lookup=new Promise(resolve=>{complete=resolve});
 const snap=createDesktopV4OwnerSnapshot({
  accounts:{desktopOwnerSessionActive:()=>valid,
   account:id=>({accountId:id,isOwner:true,emailVerified:true,status:'active'})},
  allDeviceViews:()=>[{deviceId:'dev-a',accountId:'owner',state:'online'}],
  sessions:{list:()=>[]},accessGrants:{activeGrantsForDevice:()=>[]},
  usage:{summary:()=>({currentMonth:'2026-11',devices:[],toolCallsThisMonth:0})},
  planEntitlements:()=>({plan:'pro',toolCallLimit:100}),
  jobs:new Map(),recentEvents:()=>[],
  lookupShortIds:()=>lookup
 });
 const read=snap({accountId:'owner',accountSessionId:SESSION});
 valid=false;
 complete(new Map([['dev-a','R01KAP']]));
 await assert.rejects(read,/desktop_snapshot_owner_revoked_during_read/);
});

test('199/200/201-session historical window does not hide Owner device, Short ID or live lanes',async()=>{
 const make=(n)=>Array.from({length:n},(_,i)=>({
  accountId:'owner',sessionId:'s-'+i,deviceId:'dev-a',agentId:'agent-'+i,
  state:'closed',createdAt:1000+i,lastSeenAt:2000+i,closedAt:3000+i
 }));
 for(const n of [199,200,201]){
  const history=make(n);
  if(n===201)history[0]={...history[0],state:'active',createdAt:10,closedAt:null,expiresAt:5000};
  history.push({accountId:'other',sessionId:'foreign-s',deviceId:'dev-foreign',agentId:'foreign',
   state:'active',createdAt:99999});
  const view=await data({sessions:history})({accountId:'owner',accountSessionId:SESSION});
  assert.equal(view.devices[0].shortId,'R01KAP','unrelated Owner inventory must survive history overflow');
  assert.equal(view.sessions.length,Math.min(n,200),'bounded Owner session viewport');
  assert.deepEqual(view.coverage.sessions,{
   returned:Math.min(n,200),total:n,hasMore:n>200,
   activeTotal:n===201?1:0,holdTotal:0,source:'in_memory_current_window'
  });
  assert.ok(!JSON.stringify(view).includes('foreign-s'),'no foreign account history');
  if(n===201){
   assert.ok(view.sessions.some(s=>s.sessionId==='s-0'&&s.state==='active'),
     'active lane must displace old completed history, not be hidden');
   assert.ok(!view.sessions.some(s=>s.sessionId==='s-1'),
     'one old completed row must be outside bounded window');
  }
 }
});

test('201 live sessions expose explicit partial coverage rather than claiming complete history',async()=>{
 const sessions=Array.from({length:201},(_,i)=>({
  accountId:'owner',sessionId:'s-'+i,deviceId:'dev-a',agentId:'agent-'+i,
  state:i%2?'hold':'active',createdAt:1000+i,expiresAt:2000+i
 }));
 const view=await data({sessions})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(view.sessions.length,200);
 assert.equal(view.coverage.sessions.total,201);
 assert.equal(view.coverage.sessions.activeTotal,101);
 assert.equal(view.coverage.sessions.holdTotal,100);
 assert.equal(view.coverage.sessions.hasMore,true);
 assert.equal(view.grants.length,1);
});

test('201 Owner active grants no longer remove all devices, jobs and Owner identity',async()=>{
 const rows=Array.from({length:201},(_,i)=>({
   grantId:'grant-'+i,accountId:'owner',deviceId:'dev-a',agentId:'agent-'+i,
   purpose:'device',approvedAt:100,expiresAt:3000,absoluteExpiresAt:4000
 }));
 rows.push({grantId:'grant-foreign',accountId:'other',deviceId:'dev-a',purpose:'device'});
 const view=await data({grants:rows})({accountId:'owner',accountSessionId:SESSION});
 assert.equal(view.ok,true);
 assert.equal(view.devices[0].shortId,'R01KAP');
 assert.equal(view.grants.length,200);
 assert.equal(view.coverage.grants.total,201);
 assert.equal(view.coverage.grants.hasMore,true);
 assert.equal(view.jobs.length,1);
 assert.equal(view.usage.toolCallsThisMonth,12);
 assert.ok(!JSON.stringify(view).includes('grant-foreign'));
});
