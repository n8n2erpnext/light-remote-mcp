// P2: each Agent retains its own independent A/B grant clock.
// Source-only/loopback fixture, no production or Gold UAT state writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import {DeviceAccessGrantRegistry,AB_GRANT_MAX_LIFETIME_MS}
 from '../../operator-host/device-access-grant-registry.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {handleDeviceChannelRoutes} from '../../operator-host/executor-routes-device-channel.mjs';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-ab-agent-clocks-'));
let wall=null;
try{
 let now=1_800_000_000_000;
 const registry=new DeviceAccessGrantRegistry({stateFile:path.join(temp,'grants.json'),now:()=>now});
 const base={accountId:'owner-1',deviceId:'device-1',connectionId:'conn-live',
  connectionExpiresAt:now+72*60*60*1000};
 const authorize=(agentId,label='ChatGPT')=>{
  const request=registry.request({...base,agentId,label,
   forceApproval:true,requestTtlMs:5*60_000,
   pairingId:'pair-'+agentId});
  assert.equal(request.state,'pending');
  return registry.approve(request.request.requestId,{deviceId:base.deviceId,
   connectionId:base.connectionId,connectionExpiresAt:base.connectionExpiresAt});
 };
 const a1=authorize('agent-a','Agent Alpha');
 assert.equal(registry.activeGrantsForDevice(base.deviceId,base.connectionId).length,1);
 const oldExpiry=a1.absoluteExpiresAt;
 now=oldExpiry-90_000;
 const pendingB=registry.request({...base,agentId:'agent-b',label:'Agent Beta',
  forceApproval:true,pairingId:'pair-agent-b'});
 assert.deepEqual(registry.activeGrantsForDevice(base.deviceId,base.connectionId).map(g=>g.agentId),['agent-a'],
  'request without owner B approval must never refresh a clock');
 const b1=registry.approve(pendingB.request.requestId,{deviceId:base.deviceId,
  connectionId:base.connectionId,connectionExpiresAt:base.connectionExpiresAt});
 assert.equal(b1.approvedAt,now);
 assert.equal(b1.absoluteExpiresAt,now+AB_GRANT_MAX_LIFETIME_MS);
 assert.equal(a1.absoluteExpiresAt-now,90_000,'Agent Alpha still has only 90 seconds');
 let both=registry.activeGrantsForDevice(base.deviceId,base.connectionId);
 assert.deepEqual(both.map(g=>g.agentId),['agent-b','agent-a']);
 assert.equal(both[0].label,'Agent Beta');
 assert.equal(both[1].label,'Agent Alpha');
 assert.equal(registry.activeForDevice(base.deviceId,base.connectionId).grantId,b1.grantId,
  'legacy singular field must show most recent approval, without revoking Alpha');
 assert.equal(registry.assert(a1.grantId,{touch:false}).grantId,a1.grantId);
 const reboot=new DeviceAccessGrantRegistry({stateFile:path.join(temp,'grants.json'),now:()=>now});
 assert.deepEqual(reboot.activeGrantsForDevice(base.deviceId,base.connectionId).map(g=>g.agentId),
  ['agent-b','agent-a'],'restart must retain independent clocks');
 now=oldExpiry+1000;
 assert.deepEqual(reboot.activeGrantsForDevice(base.deviceId,base.connectionId).map(g=>g.agentId),
  ['agent-b'],'Alpha expiry must not start Beta clock; Beta already counts from B approval');
 assert.throws(()=>reboot.assert(a1.grantId,{touch:false}),/device_access_grant_expired/);
 const bPending=reboot.request({...base,agentId:'agent-b',label:'Agent Beta',
  forceApproval:true,pairingId:'pair-b-renew'});
 const before=reboot.activeGrantsForDevice(base.deviceId,base.connectionId)[0];
 assert.equal(before.grantId,b1.grantId,'pending B must not reset');
 const b2=reboot.approve(bPending.request.requestId,{deviceId:base.deviceId,
  connectionId:base.connectionId,connectionExpiresAt:base.connectionExpiresAt});
 assert.notEqual(b2.grantId,b1.grantId);
 assert.equal(b2.absoluteExpiresAt,now+AB_GRANT_MAX_LIFETIME_MS);
 assert.deepEqual(reboot.activeGrantsForDevice(base.deviceId,base.connectionId).map(g=>g.grantId),[b2.grantId],
  'same Agent new owner approval closes only same Agent old grant');
 assert.throws(()=>reboot.assert(b1.grantId,{touch:false}),/device_access_grant_required/);
 const c1=reboot.request({...base,agentId:'agent-c',label:'Team C',purpose:'team-member',
  forceApproval:true,pairingId:'pair-c'});
 const cGrant=reboot.approve(c1.request.requestId,{deviceId:base.deviceId,
  connectionId:base.connectionId,connectionExpiresAt:base.connectionExpiresAt});
 assert.equal(reboot.activeGrantsForDevice(base.deviceId,base.connectionId).length,2,
  'Team Agent must get an independent timer too');
 assert.equal(reboot.activeForDevice(base.deviceId,base.connectionId).grantId,b2.grantId,
  'legacy singular field remains personal, not Team C');
 assert.equal(reboot.assert(cGrant.grantId,{touch:false}).grantId,cGrant.grantId);
 assert.equal(reboot.activeGrantsForDevice(base.deviceId,'wrong-connection').length,0);

 // The signed /status route must expose only display-safe per-Agent clocks.
 const channelRes={};
 const signedStatus=await handleDeviceChannelRoutes({method:'POST'},channelRes,
  new URL('http://operator/v1/device-channel/status'),{
   readJson:async()=>({}),verifiedChannelContext:async(_body,action)=>{
    assert.equal(action,'status');return {device:{deviceId:base.deviceId}};},
   requireDeviceConnection:()=>({connectionId:base.connectionId}),
   connections:{get:()=>({connectionId:base.connectionId})},
   sessions:{list:()=>[]},deviceView:()=>({deviceId:base.deviceId}),
   accessGrants:reboot,CONNECTION_LEASE_ENFORCE:true,
   sendJson:(res,code,value)=>{res.status=code;res.payload=value;return value;}
  });
 assert.equal(channelRes.status,200);
 assert.equal(signedStatus.access.activeGrants.length,2);
 assert.deepEqual(signedStatus.access.activeGrants.map(g=>g.agentId).sort(),['agent-b','agent-c']);
 for(const g of signedStatus.access.activeGrants){
  assert.equal(Object.hasOwn(g,'grantId'),false,'other Agents grant IDs must not leak');
  assert.equal(Object.hasOwn(g,'accountId'),false);
  assert.equal(Object.hasOwn(g,'connectionId'),false);
 }
 let reads=0;
 wall=startLocalWall({host:'127.0.0.1',port:0,
  getLocalStatus:async()=>({deviceId:base.deviceId,cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>{reads++;return {ok:true,access:{
   activeGrants:reboot.activeGrantsForDevice(base.deviceId,base.connectionId),
   activeGrant:reboot.activeForDevice(base.deviceId,base.connectionId)},sessions:[]};}});
 await new Promise((resolve,reject)=>wall.server.listening?
   resolve():wall.server.once('listening',resolve).once('error',reject));
 const url='http://127.0.0.1:'+wall.server.address().port;
 const status=await(await fetch(url+'/api/status')).json();
 assert.equal(status.remote.access.activeGrants.length,2);
 assert.equal(reads,1);
 await fetch(url+'/api/status');
 assert.equal(reads,1,'ordinary status requests use observer cache');
 const refreshed=await(await fetch(url+'/api/status?fresh=1')).json();
 assert.equal(refreshed.remote.access.activeGrants.length,2);
 assert.equal(reads,2,'approved event forces a fresh observer fetch');
 const html=await(await fetch(url+'/')).text();
 assert.match(html,/refreshStatus\(e\.type==='device_access_approved'\)/);
 assert.match(html,/fetch\('\/api\/status'\+\(fresh\?'\?fresh=1':''\)/);
 assert.match(html,/Array\.isArray\(access\.activeGrants\)/);
 assert.match(html,/Agent A\/B access · /);
 // Execute the real Wall timer rendering function with DOM stubs.
 const source=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
 const start=source.indexOf('function refreshAbGrantTimer(){');
 const end=source.indexOf('\nfunction renderPairing()',start);
 assert(start>0&&end>start);
 const timerCode=source.slice(start,end);
 const host={className:'',textContent:'',children:[],replaceChildren(...x){this.children=x;}};
 const context=vm.createContext({
  grantTimerRows:[
   {agentId:'agent-a',label:'Agent Alpha',purpose:'device',expiryAt:now+90_000},
   {agentId:'agent-b',label:'Agent Beta',purpose:'device',expiryAt:now+AB_GRANT_MAX_LIFETIME_MS},
   {agentId:'agent-c',label:'Team C',purpose:'team-member',expiryAt:now+60_000}
  ],
  remoteState:{ok:true},
  document:{getElementById:()=>host,createElement:()=>({className:'',textContent:''})},
  Date:{now:()=>now},
  String,Math,Number
 });
 vm.runInContext(timerCode+'\nrefreshAbGrantTimer()',context);
 assert.equal(host.children.length,4,'one header + one independent timer per Agent');
 assert(host.children[1].textContent.includes('Agent Alpha'));
 assert(host.children[1].textContent.includes('00:01:30'));
 assert(host.children[2].textContent.includes('Agent Beta'));
 assert(host.children[2].textContent.includes('24:00:00'));
 assert(host.children[3].textContent.includes('Team C'));
 vm.runInContext('grantTimerRows[0].expiryAt=Date.now()-1;refreshAbGrantTimer()',context);
 assert.equal(host.children.length,3,'expired Alpha disappears, Beta clock unaffected');
 // A brand-new owner B approval must invalidate Wall's 12-second cached
 // /status immediately, even if the SSE observer is delayed or disconnected.
 await wall.close();wall=null;
 const pendingD=reboot.request({...base,agentId:'agent-d',label:'Agent Delta',
  forceApproval:true,pairingId:'pair-agent-d'});
 let ownerReads=0;
 const auth={enabled:true,identity:req=>req.headers['x-test-owner']==='yes'?
  {username:'owner@example.invalid'}:null,
  csrfForRequest:()=> 'valid-csrf',verifyRequestCsrf:()=>true};
 wall=startLocalWall({host:'127.0.0.1',port:0,auth,
  getLocalStatus:async()=>({deviceId:base.deviceId,
   cloudDesiredConnected:true,cloudState:'connected'}),
  getRemoteStatus:async()=>{
   ownerReads++;return {ok:true,access:{
    activeGrants:reboot.activeGrantsForDevice(base.deviceId,base.connectionId),
    activeGrant:reboot.activeForDevice(base.deviceId,base.connectionId)},sessions:[]};
  },
  getPendingAccess:async()=>({ok:true,device:{displayName:'Device One'},
   access:{pending:reboot.pendingForDevice(base.deviceId)}}),
  accessApprove:async requestId=>reboot.approve(requestId,{
   deviceId:base.deviceId,connectionId:base.connectionId,
   connectionExpiresAt:base.connectionExpiresAt})});
 await new Promise((resolve,reject)=>wall.server.listening?
  resolve():wall.server.once('listening',resolve).once('error',reject));
 const wallUrl='http://127.0.0.1:'+wall.server.address().port;
 const ownerHeaders={'x-test-owner':'yes'};
 const priorStatus=await(await fetch(wallUrl+'/api/status',{headers:ownerHeaders})).json();
 assert.equal(priorStatus.remote.access.activeGrants.length,2);
 assert.equal(ownerReads,1);
 const approval=await fetch(wallUrl+'/api/approve',{method:'POST',
  headers:{...ownerHeaders,'content-type':'application/json',
   'x-light-remote-csrf':'valid-csrf'},
  body:JSON.stringify({code:pendingD.request.userCode,decision:'approve'})});
 assert.equal(approval.status,200,'new B must be owner approved');
 assert.equal((await approval.json()).decision,'approved');
 const after=await(await fetch(wallUrl+'/api/status',{headers:ownerHeaders})).json();
 assert.equal(after.remote.access.activeGrants.length,3,
  'post B approval must invalidate Wall status cache immediately');
 assert.equal(ownerReads,2);
 console.log('GOLD_AB_WALL_B_APPROVAL_IMMEDIATE_PER_AGENT_STATUS=PASS');
 console.log('GOLD_AB_EACH_AGENT_INDEPENDENT_24H_REAPPROVAL_RESTART_SCOPE=PASS');
 console.log('GOLD_WALL_MULTI_AGENT_TIMERS_HTTP_RENDER_EVENT_REFRESH=PASS');
}finally{if(wall)await wall.close();fs.rmSync(temp,{recursive:true,force:true});}
