import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EnrollmentRegistry} from '../../operator-host/enrollment-registry.mjs';
import {DeviceRegistry} from '../../operator-host/device-registry.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-linux-server-relink-'));
const stateFile=path.join(dir,'device.json');
const cli=fileURLToPath(new URL('../../device-agent/operator-agent.mjs',import.meta.url));
const signer=crypto.generateKeyPairSync('ed25519');
const signerPublic=signer.publicKey.export({format:'der',type:'spki'}).toString('base64');
let begun=null,phase='original',validCertificate=true,heartbeatCount=0,pollStatus='approved';
const originalAccount='acct_legacy_owner',newAccount='acct_verified_owner';
function respond(res,status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
function digest(publicKey){return crypto.createHash('sha256').update(Buffer.from(publicKey,'base64')).digest('hex');}
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 let data={};try{data=JSON.parse(raw||'{}')}catch{}
 if(req.url!=='/api/operator')return respond(res,404,{ok:false,error:'not_found'});
 const {action,payload}=data;
 if(action==='enrollment-begin'){
  begun=payload;
  return respond(res,200,{ok:true,upstream:{enrollment:{
   enrollmentId:'enr_'+crypto.randomUUID(),pollToken:'p'.repeat(43),
   deviceCode:phase==='original'?'OLD1-ABCD':'NEW1-ABCD',
   activationUrl:'https://goldabv2.example.test/enroll',
   expiresAt:Date.now()+600000,expiresInSeconds:600
  }}});
 }
 if(action==='enrollment-poll'){
  if(pollStatus!=='approved')return respond(res,200,{ok:true,upstream:{enrollment:{state:pollStatus}}});
  const hash=digest(begun.publicIdentityKey),deviceId='dev_'+hash.slice(0,24),
  approvedCapabilities=phase==='original'?begun.capabilities.filter(c=>c!=='terminal'):begun.capabilities,
    accountId=phase==='original'?originalAccount:newAccount;
  const certificate={version:1,certificateId:'cert_'+crypto.randomUUID(),
   deviceId,accountId,publicKeySha256:validCertificate?hash:'bad-hash',
   publicIdentityKey:begun.publicIdentityKey,approvedCapabilities,
   policyProfile:begun.policyProfile,issuedAt:Date.now(),notAfter:Date.now()+86400000};
  const signature=crypto.sign(null,Buffer.from(JSON.stringify(certificate)),signer.privateKey).toString('base64url');
  return respond(res,200,{ok:true,upstream:{enrollment:{
   state:'approved',enrollmentId:payload.enrollmentId,deviceId,accountId,
   approvedCapabilities,policyProfile:begun.policyProfile,
   certificate,certificateSignature:signature,
   signer:{algorithm:'Ed25519',publicKey:signerPublic}
  }}});
 }
 if(action==='device-heartbeat'){
  heartbeatCount++;
  return respond(res,200,{ok:true,upstream:{device:{deviceId:payload.deviceId,state:'online'}}});
 }
 return respond(res,400,{ok:false,error:'unsupported_action'});
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
function run(argv,consolePermit=false){return new Promise((resolve,reject)=>{
 const env={...process.env,OPERATOR_AGENT_STATE:stateFile,
  OPERATOR_AGENT_IDENTITY_FILE:'',OPERATOR_AGENT_BASE_URL:base,OPERATOR_AGENT_HUB_URL:base,
  LR_LINUX_RELINK_CONSOLE:consolePermit?'1':''};
 const useRootRunner=consolePermit&&(argv.includes('--relink')||argv.includes('poll'));
 const command=useRootRunner?'sudo':process.execPath;
 const args=useRootRunner?[
   '-n','runuser','-u',os.userInfo().username,'--','env',
   'OPERATOR_AGENT_STATE='+stateFile,'OPERATOR_AGENT_IDENTITY_FILE=',
   'OPERATOR_AGENT_BASE_URL='+base,'OPERATOR_AGENT_HUB_URL='+base,
   'LR_LINUX_RELINK_CONSOLE=1',process.execPath,cli,...argv
 ]:[cli,...argv];
 const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';
 child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
 child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));
});}
function state(){return JSON.parse(fs.readFileSync(stateFile,'utf8'));}
try{
 const first=await run(['login','--no-wait','--deny','sudo-on-demand']);
 assert.equal(first.code,0,first.stderr);
 const firstPoll=await run(['poll']);
 assert.equal(firstPoll.code,0,firstPoll.stderr);
 const old=state(),oldId=old.enrollment.deviceId,oldKey=old.identity.publicIdentityKey;
 assert.equal(old.enrollment.accountId,originalAccount);
 const originalApproved=old.enrollment.approvedCapabilities;
 assert.equal(originalApproved.includes('terminal'),false);
 assert.equal(old.cloud.desiredConnected,false);
 phase='new';
 const forbidden=await run(['login','--relink','--no-wait']);
 assert.equal(forbidden.code,1,'must need explicit local console gate');
 assert.match(forbidden.stderr,/relink_local_console_required/);
 assert.equal(state().identity.publicIdentityKey,oldKey);
 const forbiddenLegacy=await run(['login','--reenroll','--no-wait']);
 assert.equal(forbiddenLegacy.code,1);
 assert.match(forbiddenLegacy.stderr,/relink_local_console_required/);
 const begin=await run(['login','--relink','--no-wait'],true);
 assert.equal(begin.code,0,begin.stderr);
 assert.match(begin.stdout,/Device code: NEW1-ABCD/);
 const pending=state();
 assert.equal(pending.identity.publicIdentityKey,oldKey);
 assert.equal(pending.enrollment.deviceId,oldId);
 assert.equal(pending.enrollment.accountId,originalAccount);
 assert.ok(pending.pendingEnrollment.relinkIdentity.privateKey);
 assert.notEqual(pending.pendingEnrollment.relinkIdentity.publicIdentityKey,oldKey);
 assert.notEqual(begun.publicIdentityKey,oldKey);
 assert.deepEqual([...begun.capabilities].sort(),[...originalApproved].sort(),'cross-owner approval ceiling');
 assert.deepEqual([...pending.pendingEnrollment.requestedCapabilities].sort(),
  [...originalApproved].sort(),'persisted grantable ceiling must not be expanded');
 assert.equal(pending.pendingEnrollment.requestedCapabilities.includes('terminal'),false);
 assert.equal((fs.statSync(stateFile).mode&0o777),0o600);
 assert.ok(!begin.stdout.includes(pending.pendingEnrollment.relinkIdentity.privateKey));
 assert.ok(!begin.stdout.includes(pending.pendingEnrollment.pollToken));
 validCertificate=false;
 const unprivilegedPoll=await run(['poll']);
 assert.equal(unprivilegedPoll.code,1);
 assert.match(unprivilegedPoll.stderr,/relink_local_console_required/);
 const tampered=await run(['poll'],true);
 assert.equal(tampered.code,1,'reject mismatched signed identity');
 assert.match(tampered.stderr,/device_certificate_identity_mismatch/);
 assert.equal(state().identity.publicIdentityKey,oldKey);
 assert.equal(state().enrollment.accountId,originalAccount);
 validCertificate=true;
 const completed=await run(['poll'],true);
 assert.equal(completed.code,0,completed.stderr);
 const next=state();
 assert.equal(next.enrollment.accountId,newAccount);
 assert.notEqual(next.identity.publicIdentityKey,oldKey);
 assert.notEqual(next.enrollment.deviceId,oldId);
 assert.equal(next.enrollment.certificate.accountId,newAccount);
 assert.equal(next.pendingEnrollment,undefined);
 assert.equal(next.cloud.desiredConnected,false);
 assert.equal(next.cloud.state,'dormant');
 assert.equal(next.policy.deniedCapabilities.includes('sudo-on-demand'),true);
 assert.equal(next.effectiveCapabilities.includes('sudo-on-demand'),false);
 assert.ok(heartbeatCount>=2);
 console.log('LINUX_OWNER_RELINK_ROTATED_IDENTITY_SIGNED_NEW_ACCOUNT_AND_DORMANT=PASS');
 console.log('LINUX_OWNER_RELINK_PRESERVED_OLD_UNTIL_APPROVED_AND_REJECTED_BAD_CERT=PASS');
 console.log('LINUX_OWNER_RELINK_LOCAL_CONSOLE_GUARD_AND_DENY_POLICY=PASS');
 const keys=crypto.generateKeyPairSync('ed25519');
 const pub=keys.publicKey.export({format:'der',type:'spki'}).toString('base64');
 const registry=new EnrollmentRegistry();
 const reqBase={publicIdentityKey:pub,displayName:'Linux Server',platform:'linux',
  architecture:'arm64',agentVersion:'test',capabilities:['filesystem']};
 const devices=new DeviceRegistry({now:()=>Date.now()});
 const a=registry.begin(reqBase);
 const initialBinding=registry.approve({code:a.deviceCode,accountId:originalAccount});
 devices.enroll({deviceId:initialBinding.deviceId,nodeId:initialBinding.deviceId,
  accountId:originalAccount,publicIdentityKey:pub,displayName:'Linux Server',
  platform:'linux',architecture:'arm64',capabilities:['filesystem']});
 const b=registry.begin(reqBase);
 assert.throws(()=>registry.approve({code:b.deviceCode,accountId:newAccount}),
  /device_relink_requires_new_identity_key/);
 const oldDevice='dev_'+digest(pub).slice(0,24);
 assert.equal(registry.binding(oldDevice).accountId,originalAccount);
 const newKeys=crypto.generateKeyPairSync('ed25519');
 const rotated=registry.begin({...reqBase,publicIdentityKey:newKeys.publicKey.export({format:'der',type:'spki'}).toString('base64')});
 const approved=registry.approve({code:rotated.deviceCode,accountId:newAccount});
 assert.notEqual(approved.deviceId,oldDevice);
 // A Revoke explicitly releases the previous account's claim: any new
 // account (including old Owner) can LINK the same device key through Wall.
 registry.revoke({deviceId:oldDevice,accountId:originalAccount});
 devices.revoke(oldDevice,'account_owner_revoked');
 const linkAfterRevoke=registry.begin(reqBase);
 const transferredByLink=registry.approve({
  code:linkAfterRevoke.deviceCode,accountId:newAccount
 });
 assert.equal(transferredByLink.deviceId,oldDevice);
 const reopened=devices.enroll({deviceId:transferredByLink.deviceId,
  nodeId:transferredByLink.deviceId,accountId:newAccount,
  publicIdentityKey:pub,displayName:'Linux Server',
  platform:'linux',architecture:'arm64',capabilities:['filesystem']});
 assert.equal(reopened.accountId,newAccount);
 assert.equal(reopened.state,'offline');
 assert.equal(registry.binding(oldDevice).accountId,newAccount);
 assert.equal(registry.binding(oldDevice).revokedAt,undefined);
 const remainAssigned=registry.begin(reqBase);
 assert.throws(()=>registry.approve({
  code:remainAssigned.deviceCode,accountId:originalAccount
 }),/device_relink_requires_new_identity_key/);
 console.log('LINUX_WALL_REVOKED_DEVICE_LINKS_ANY_ACCOUNT_BUT_ACTIVE_RELINK_DENIED=PASS');
 console.log('LINUX_OWNER_RELINK_BACKEND_REJECTS_CROSS_TENANT_SAME_KEY=PASS');
}finally{
 server.close();fs.rmSync(dir,{recursive:true,force:true});
}
