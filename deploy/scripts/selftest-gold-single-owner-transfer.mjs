import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {AccountRegistry,AccountError} from '../../operator-host/account-registry.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const folder=fs.mkdtempSync(path.join(os.tmpdir(),'gold-owner-transfer-'));
const OWNER='acct_bootstrap',NEXT='acct_verified';
const oldPass='old-owner-integration-password';
const nextPass='new-owner-integration-password';
const oldEmail='legacy-owner@example.invalid';
const nextEmail='verified-owner@example.test';
const registry=new AccountRegistry({stateFile:path.join(folder,'accounts.json'),bootstrapAccountId:OWNER});
const err=(action,message,status)=>assert.throws(action,e=>e instanceof AccountError&&e.message===message&&e.status===status);
try {
 const issued=registry.register({email:oldEmail,password:oldPass});
 const priorToken=issued.token;
 registry._createAccount({accountId:'acct_unverified',email:'unverified@example.test',
   password:'unverified-user-password',emailVerified:false});
 registry._createAccount({accountId:NEXT,email:nextEmail,password:nextPass,emailVerified:true});
 const nextToken=registry.login({email:nextEmail,password:nextPass}).token;
 const data={fromAccountId:OWNER,toAccountId:NEXT,currentPassword:oldPass,
  confirmText:'TRANSFER OWNER TO '+nextEmail,acknowledgeDeviceIsolation:true,
  previousOwnerDeviceCount:3};
 assert.equal(registry.account(OWNER).emailVerified,false);
 err(()=>registry.transferOwner({...data,toAccountId:OWNER}),'owner_transfer_target_invalid',400);
 err(()=>registry.transferOwner({...data,toAccountId:'acct_unverified',
  confirmText:'TRANSFER OWNER TO unverified@example.test'}),
  'owner_transfer_target_email_not_verified',403);
 err(()=>registry.transferOwner({...data,currentPassword:'incorrect'}),
  'owner_transfer_current_password_invalid',401);
 err(()=>registry.transferOwner({...data,confirmText:'TRANSFER OWNER'}),
  'owner_transfer_confirmation_mismatch',400);
 err(()=>registry.transferOwner({...data,acknowledgeDeviceIsolation:false}),
  'owner_transfer_device_isolation_ack_required',409);
 assert.equal(registry.account(OWNER).isOwner,true);
 const steps=[];
 const deps={accounts:registry,AccountError,
  requireAccount:req=>registry.authenticate(req.headers['x-light-account-session']),
  readJson:async req=>req.body,sendJson:(_res,status,body)=>({status,...body}),
  allDeviceViews:()=>[1,2,3].map(n=>({deviceId:'dev'+n,accountId:OWNER,state:'offline'})),
  flushGoldRegistries:async()=>{steps.push('commit')},
  closeRuntimeForAccount:()=>{steps.push('close');return ['dev1','dev2','dev3']},
  fleetAuthority:{invalidateAccount:()=>steps.push('invalidate')}
 };
 const request=async(method,route,body={})=>handleAccountRoutes({
  method,body,headers:{'x-light-account-session':priorToken}},
  {},new URL('http://operator'+route),deps);
 const before=await request('GET','/v1/admin/owner-authority');
 assert.equal(before.ownerAccountId,OWNER);
 assert.equal(before.ownerEmail,oldEmail);
 assert.equal(before.ownerEmailVerified,false);
 assert.equal(before.candidates.length,1);
 const done=await request('POST','/v1/admin/owner-transfer',{
  toAccountId:NEXT,currentPassword:oldPass,confirmText:data.confirmText,
  acknowledgeDeviceIsolation:true});
 assert.equal(done.status,200);assert.equal(done.newOwnerAccountId,NEXT);
 assert.deepEqual(steps,['commit','commit','close','invalidate']);
 assert.equal(registry.ownerAccountId,NEXT);
 assert.equal(registry.ownerRevision,1);
 assert.equal(registry.account(OWNER).status,'admin_disabled');
 assert.equal(registry.account(NEXT).isOwner,true);
 assert.equal(registry.list().filter(a=>a.isOwner).length,1);
 err(()=>registry.setAdminStatus(NEXT,{status:'admin_disabled'}),
  'account_disable_protected',409);
 err(()=>registry.authenticate(priorToken),'account_session_required',401);
 err(()=>registry.authenticate(nextToken),'account_session_required',401);
 err(()=>registry.login({email:oldEmail,password:oldPass}),'account_admin_disabled',403);
 assert.equal(registry.login({email:nextEmail,password:nextPass}).account.isOwner,true);
 const reloaded=new AccountRegistry({stateFile:path.join(folder,'accounts.json'),bootstrapAccountId:OWNER});
 assert.equal(reloaded.ownerAccountId,NEXT);assert.equal(reloaded.ownerRevision,1);
 assert.equal(reloaded.account(OWNER).status,'admin_disabled');
 err(()=>reloaded.transferOwner(data),'owner_transfer_not_current_owner',403);
 console.log('GOLD_SINGLE_OWNER_TRANSITION_VERIFIED_TARGET_ATOMIC_SESSION_REVOCATION_PERSISTENCE=PASS');
}finally{fs.rmSync(folder,{recursive:true,force:true});}
