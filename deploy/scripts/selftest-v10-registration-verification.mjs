import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountRegistry } from '../../operator-host/account-registry.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-registration-verification-'));
const stateFile=path.join(dir,'accounts.json');
let now=Date.now();
const r=new AccountRegistry({stateFile,now:()=>now});
function expectError(fn,message){let got='';try{fn()}catch(e){got=e.message}if(got!==message)throw new Error('expected_'+message+'_got_'+got);}

try{
  const first=r.beginPendingRegistration({email:'pending@example.test',password:'Pending password 12345'});
  if(first.pending.sendCount!==1||first.pending.maxSends!==5||first.pending.maxPinAttempts!==3)throw new Error('initial_policy_invalid');
  if(r.list().length!==0||r.listPendingRegistrations().length!==1)throw new Error('pending_became_active');
  const disk=fs.readFileSync(stateFile,'utf8');
  if(disk.includes(first.token)||disk.includes(first.pin))throw new Error('verification_secret_persisted_plaintext');

  expectError(()=>r.verifyPendingRegistration({pendingId:first.pending.pendingId,pin:'111111',issueSession:false}),'verification_pin_invalid');
  expectError(()=>r.verifyPendingRegistration({pendingId:first.pending.pendingId,pin:'222222',issueSession:false}),'verification_pin_invalid');
  expectError(()=>r.verifyPendingRegistration({pendingId:first.pending.pendingId,pin:'333333',issueSession:false}),'verification_challenge_locked');
  expectError(()=>r.verifyPendingRegistration({token:first.token,issueSession:false}),'verification_challenge_locked');

  now+=60_000;
  const second=r.resendPendingVerification(first.pending.pendingId);
  if(second.pending.sendCount!==2||second.pending.pinAttempts!==0||second.pending.challengeLocked)throw new Error('resend_not_reset');
  expectError(()=>r.verifyPendingRegistration({token:first.token,issueSession:false}),'pending_registration_not_found');
  expectError(()=>r.verifyPendingRegistration({pendingId:second.pending.pendingId,token:first.token,issueSession:false}),'verification_link_invalid');
  if(r.pendingRegistration(second.pending.pendingId).pinAttempts!==0)throw new Error('invalid_link_counted_as_pin_attempt');
  const activated=r.verifyPendingRegistration({pendingId:second.pending.pendingId,pin:second.pin,issueSession:false});
  if(!activated.account.emailVerified||activated.account.plan!=='free'||activated.account.groupId!=='grp_customers')throw new Error('activation_invalid');
  if(r.listPendingRegistrations().length!==0||r.list().length!==1)throw new Error('activation_state_invalid');

  const google=r.googleLoginOrSignupIntent({sub:'google-pending-sub',email:'google-pending@example.test',emailVerified:true});
  if(!google.registrationRequired||!google.googleSignupToken)throw new Error('google_new_account_not_pending');
  const inspect=r.googleSignupIntent(google.googleSignupToken);
  if(inspect.email!=='google-pending@example.test')throw new Error('google_intent_inspect_failed');
  const gp=r.beginPendingRegistration({email:'ignored@example.test',password:'Google pending password 12345',googleSignupToken:google.googleSignupToken});
  if(gp.pending.provider!=='google'||gp.pending.email!=='google-pending@example.test')throw new Error('google_pending_provider_failed');
  const ga=r.verifyPendingRegistration({token:gp.token,issueSession:false});
  if(!ga.account.authProviders.includes('google')||!ga.account.authProviders.includes('password')||!ga.account.emailVerified)throw new Error('google_activation_invalid');

  const resend=r.beginPendingRegistration({email:'resend@example.test',password:'Resend password 12345'});
  expectError(()=>r.resendPendingVerification(resend.pending.pendingId),'verification_resend_cooldown');
  now+=60_000;const rs2=r.resendPendingVerification(resend.pending.pendingId);if(rs2.pending.sendCount!==2)throw new Error('send2');
  now+=120_000;const rs3=r.resendPendingVerification(resend.pending.pendingId);if(rs3.pending.sendCount!==3)throw new Error('send3');
  now+=5*60_000;const rs4=r.resendPendingVerification(resend.pending.pendingId);if(rs4.pending.sendCount!==4)throw new Error('send4');
  now+=15*60_000;const rs5=r.resendPendingVerification(resend.pending.pendingId);if(rs5.pending.sendCount!==5||rs5.pending.resendAvailableAt!==null)throw new Error('send5');
  expectError(()=>r.resendPendingVerification(resend.pending.pendingId),'verification_send_limit_reached');

  const exp=r.beginPendingRegistration({email:'expire@example.test',password:'Expire pending password 12345'});
  now=exp.pending.expiresAt+1;
  if(r.listPendingRegistrations().some(x=>x.pendingId===exp.pending.pendingId))throw new Error('pending_not_expired');
  const retry=r.beginPendingRegistration({email:'expire@example.test',password:'Expire pending password 67890'});
  if(!retry.pending.pendingId)throw new Error('expired_email_not_released');

  const group=r.createGroup('Beta testers');
  const accountId=activated.account.accountId;
  let moved=r.setAccountGroup(accountId,group.groupId);
  if(moved.groupName!=='Beta testers')throw new Error('group_assign_failed');
  r.renameGroup(group.groupId,'Early access');
  moved=r.account(accountId);if(moved.groupName!=='Early access')throw new Error('group_rename_failed');
  const deleted=r.deleteGroup(group.groupId,{moveTo:'grp_default'});
  if(deleted.moved!==1||r.account(accountId).groupId!=='grp_default')throw new Error('group_delete_move_failed');

  console.log('registration-pending-24h=PASS');
  console.log('verification-link-pin-shared-challenge=PASS');
  console.log('verification-pin-max-3=PASS');
  console.log('verification-resend-backoff-max-5=PASS');
  console.log('verification-secrets-hashed=PASS');
  console.log('google-signup-password-verification=PASS');
  console.log('account-groups=PASS');
} finally {
  fs.rmSync(dir,{recursive:true,force:true});
}
