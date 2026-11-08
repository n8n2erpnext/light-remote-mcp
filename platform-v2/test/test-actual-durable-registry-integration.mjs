import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DeviceRegistry} from '../../operator-host/device-registry.mjs';
import {EnrollmentRegistry} from '../../operator-host/enrollment-registry.mjs';
import {loadOrCreateHostDeviceIdentity,ensureHostCompanionState}
 from '../../operator-host/host-device-identity.mjs';

test('rc50 actual dev registries persist and reload across independent instances',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-p0-writers-'));
 try{
  const f=n=>path.join(dir,n);
  const devices=new DeviceRegistry({stateFile:f('devices.json')});
  devices._persist();
  assert.equal(JSON.parse(fs.readFileSync(f('devices.json'))).schemaVersion,1);
  const signerFile=f('enrollment-signer.json'),stateFile=f('enrollments.json');
  const enroll=new EnrollmentRegistry({stateFile,signerFile});
  enroll._persist();
  const enrollReload=new EnrollmentRegistry({stateFile,signerFile});
  assert.equal(enrollReload.signer.publicEncoded,enroll.signer.publicEncoded);
  assert.equal(enrollReload.loadError,null);
  const identity=loadOrCreateHostDeviceIdentity(f('host-device-identity.json'));
  const again=loadOrCreateHostDeviceIdentity(f('host-device-identity.json'));
  assert.equal(identity.publicKey,again.publicKey);
  const binding={deviceId:'dev_uat_local',accountId:'acct_uat',
    approvedCapabilities:['shell'],grantableCapabilities:['shell'],
    policyProfile:'default',policyRevision:1};
  const companion=ensureHostCompanionState(f('host-companion-device.json'),{
   identity,binding,signer:'uat-signer',nodeId:'uat-node'
  });
  assert.equal(companion.enrollment.deviceId,'dev_uat_local');
  assert.equal(companion.policy.localFinalDenyBoundary,true);
  const expected=['devices.json','enrollment-signer.json','enrollments.json',
    'host-device-identity.json','host-companion-device.json'];
  assert.deepEqual(fs.readdirSync(dir).sort(),expected.sort());
  for(const name of expected){
   const file=f(name);
   assert.equal(fs.statSync(file).mode&0o777,0o600);
   assert.equal(fs.statSync(file).nlink,1);
   assert.equal(fs.lstatSync(file).isFile(),true);
   const data=JSON.parse(fs.readFileSync(file,'utf8'));
   if(name==='host-companion-device.json')
     assert.equal(data.enrollment.deviceId,'dev_uat_local');
   else assert.ok(data.schemaVersion>=1);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
