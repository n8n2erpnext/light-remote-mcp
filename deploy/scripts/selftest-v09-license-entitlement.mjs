import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {LicenseKeyRegistry} from '../../operator-host/license-key-registry.mjs';
import {AccountRegistry} from '../../operator-host/account-registry.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-license-'));let now=Date.UTC(2026,8,12,0,0,0);
try{
  const accounts=new AccountRegistry({stateFile:path.join(dir,'accounts.json'),now:()=>now});
  const proof=accounts.issueOwnerProof({accountId:'self-hosted-local',deviceId:'arm-local'});accounts.consumeOwnerProof(proof.code);
  const registered=accounts.register({email:'owner@example.test',password:'correct horse battery staple'});
  const licenses=new LicenseKeyRegistry({stateFile:path.join(dir,'licenses.json'),now:()=>now});
  const issued=licenses.issue({plan:'pro',durationDays:30,label:'mail-order-1'});
  if(fs.readFileSync(path.join(dir,'licenses.json'),'utf8').includes(issued.key))throw new Error('plaintext_license_persisted');
  const candidate=licenses.inspect(issued.key);let account=accounts.applyEntitlement(registered.account.accountId,{plan:candidate.plan,durationMs:candidate.durationMs,source:'redeem_key',sourceRef:candidate.licenseId});licenses.consume(candidate.licenseId,account.accountId);
  if(account.plan!=='pro'||account.entitlement?.source!=='redeem_key')throw new Error('pro_redeem_failed');
  const firstExpiry=account.entitlement.validUntil;const issued2=licenses.issue({plan:'pro',durationDays:30});const c2=licenses.inspect(issued2.key);account=accounts.applyEntitlement(account.accountId,{plan:c2.plan,durationMs:c2.durationMs,source:'redeem_key',sourceRef:c2.licenseId});licenses.consume(c2.licenseId,account.accountId);
  if(account.entitlement.validUntil!==firstExpiry+30*86400000)throw new Error('same_plan_extension_failed');
  const vip=licenses.issue({plan:'vip',durationDays:30});const cv=licenses.inspect(vip.key);account=accounts.applyEntitlement(account.accountId,{plan:cv.plan,durationMs:cv.durationMs,source:'redeem_key',sourceRef:cv.licenseId});licenses.consume(cv.licenseId,account.accountId);
  if(account.plan!=='vip'||account.entitlement.validUntil!==now+30*86400000)throw new Error('vip_upgrade_failed');
  now+=31*86400000;if(accounts.account(account.accountId).plan!=='free')throw new Error('entitlement_expiry_failed');
  const admin=accounts.setPlan(account.accountId,'vip');if(admin.plan!=='vip'||admin.entitlement?.source!=='admin'||admin.entitlement.validUntil!==null)throw new Error('admin_entitlement_failed');
  console.log('v09-license-hash-only=PASS');console.log('v09-license-pro-redeem=PASS');console.log('v09-license-renew-extension=PASS');console.log('v09-license-upgrade=PASS');console.log('v09-entitlement-expiry=PASS');console.log('v09-admin-entitlement=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
