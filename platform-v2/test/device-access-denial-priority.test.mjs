import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DeviceAccessGrantRegistry} from '../../operator-host/device-access-grant-registry.mjs';

test('an explicitly denied A/B request cannot inherit another concurrent approved grant',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-rc50-ab-deny-'));
 const stateFile=path.join(dir,'grants.json');
 let now=1792100000000;
 const spec={accountId:'uat_account',deviceId:'uat_device',agentId:'uat_agent',
   connectionId:'uat_connection',connectionExpiresAt:now+3*60*60*1000};
 try{
  const r=new DeviceAccessGrantRegistry({stateFile,now:()=>now});
  const granted=r.request({...spec,label:'First pending approval'});
  const denied=r.request({...spec,label:'Owner will explicitly deny'});
  const ok=r.approve(granted.request.requestId,{deviceId:spec.deviceId,
    connectionId:spec.connectionId,connectionExpiresAt:spec.connectionExpiresAt});
  assert.equal(ok.agentId,spec.agentId);
  r.deny(denied.request.requestId,'owner_denied',{deviceId:spec.deviceId});
  const rejected={requestId:denied.request.requestId,pollToken:denied.pollToken};
  assert.throws(()=>r.poll(rejected),{message:'plus_authorization_denied'});
  assert.equal(r.assert(ok.grantId,{touch:false}).grantId,ok.grantId,
    'denying request B must not silently close independently granted request A');
  const reloaded=new DeviceAccessGrantRegistry({stateFile,now:()=>now});
  assert.throws(()=>reloaded.poll(rejected),{message:'plus_authorization_denied'},
    'denied outcome must survive a fresh process/reload');
  assert.equal(reloaded.assert(ok.grantId,{touch:false}).grantId,ok.grantId);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('expired request must never inherit another concurrent active grant',()=>{
 let now=1792100000000;
 const spec={accountId:'uat_account',deviceId:'uat_device',agentId:'uat_agent',
   connectionId:'uat_connection',connectionExpiresAt:now+3*60*60*1000};
 const r=new DeviceAccessGrantRegistry({now:()=>now});
 const accepted=r.request(spec);
 const pending=r.request({...spec,requestTtlMs:30_000});
 const grant=r.approve(accepted.request.requestId,{deviceId:spec.deviceId,
   connectionId:spec.connectionId,connectionExpiresAt:spec.connectionExpiresAt});
 now=pending.request.expiresAt+1;
 assert.equal(r.assert(grant.grantId,{touch:false}).grantId,grant.grantId);
 assert.throws(()=>r.poll({requestId:pending.request.requestId,pollToken:pending.pollToken}),
   {message:'plus_authorization_expired'});
});

test('unexpired still-pending request may reuse a separately approved grant as before',()=>{
 let now=1792100000000;
 const spec={accountId:'uat_account',deviceId:'uat_device',agentId:'uat_agent',
   connectionId:'uat_connection',connectionExpiresAt:now+3*60*60*1000};
 const r=new DeviceAccessGrantRegistry({now:()=>now});
 const first=r.request(spec),second=r.request(spec);
 const grant=r.approve(first.request.requestId,{deviceId:spec.deviceId,
   connectionId:spec.connectionId,connectionExpiresAt:spec.connectionExpiresAt});
 const response=r.poll({requestId:second.request.requestId,pollToken:second.pollToken});
 assert.equal(response.state,'approved');
 assert.equal(response.grant.grantId,grant.grantId);
});

test('grant approved before request timeout can still be polled afterward',()=>{
 let now=1792100000000;
 const spec={accountId:'uat_account',deviceId:'uat_device',agentId:'uat_agent',
   connectionId:'uat_connection',connectionExpiresAt:now+3*60*60*1000};
 const r=new DeviceAccessGrantRegistry({now:()=>now});
 const request=r.request({...spec,requestTtlMs:30_000});
 const grant=r.approve(request.request.requestId,{deviceId:spec.deviceId,
   connectionId:spec.connectionId,connectionExpiresAt:spec.connectionExpiresAt});
 now=request.request.expiresAt+1;
 const result=r.poll({requestId:request.request.requestId,pollToken:request.pollToken});
 assert.equal(result.state,'approved');
 assert.equal(result.grant.grantId,grant.grantId);
});
