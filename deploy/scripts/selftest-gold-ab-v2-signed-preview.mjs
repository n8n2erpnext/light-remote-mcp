// P2-I2f signed-channel preview fixture: no real Agent/network or UAT.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldAbV2SignedPreview} from '../../operator-host/gold-ab-v2-signed-preview.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'abv2-signed-preview-'));
const secret=path.join(root,'seal');
fs.writeFileSync(secret,crypto.randomBytes(32),{mode:0o600});
const owner='owner1',deviceId='dev1',connectionId='conn1';
const env={LIGHT_REMOTE_GOLD_ROOT:root,LR_GOLD_AB_V2_SEAL_KEY_FILE:secret,
 LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'1',LR_GOLD_AB_V2_WALL_PENDING_PREVIEW:'1',
 LR_GOLD_AB_V2_OWNER_ORIGIN:'https://gold.example.test',
 LR_GOLD_AB_V2_OWNER_ALLOWED_ACCOUNTS:owner,
 LR_GOLD_AB_V2_OWNER_ALLOWED_DEVICES:deviceId};
let account={accountId:owner,emailVerified:true,email:'OWNER@EXAMPLE.TEST'};
let device={deviceId,accountId:owner,state:'online',publicIdentityKey:'key1'};
let enrollment={deviceId,accountId:owner,publicIdentityKey:'key1',revokedAt:null};
let connection={deviceId,accountId:owner,connectionId,hardExpiresAt:Date.now()+300000};
let policy={accountId:owner,policyProfile:'default',approvedCapabilities:['filesystem']};
const calls=[];
const storage={prefix:'lr:gold:sourcefixture:',redis:{
 zRange:async()=>connection.connectionId===connectionId?['av2_'+'a'.repeat(32)]:[],
 eval:async(_lua,{keys,arguments:args})=>{
  calls.push({keys,operation:args[0],scope:JSON.parse(args[1])});
  if(args[0]!=='wall')throw Error('unexpected_nonread_redis_command');
  return JSON.stringify({requestId:'av2_'+'a'.repeat(32),state:'pending',attempt:1,
   expiresAt:Date.now()+200000,aCode:'ABCD02-GHFDX',requester:'Agent 1',
   bCode:'FORBIDDEN_B',box:{ct:'ENCRYPTED_B'},codeHash:'FORBIDDEN_HASH'});
 }
}};
const make=()=>createGoldAbV2SignedPreview({env,storage,
 accounts:{assertOperational:()=>account},devices:{get:()=>device},
 connections:{assertConnected:()=>connection},
 enrollments:{binding:()=>enrollment,policyView:()=>policy}});
const binding={deviceId,accountId:owner,publicIdentityKey:'key1'};
const ctx={binding,proof:{binding,proof:{action:'abv2-pending-preview'}},device};
try{
 assert.equal(createGoldAbV2SignedPreview({env:{},storage}),null);
 assert.throws(()=>createGoldAbV2SignedPreview({env:{...env,LR_GOLD_AB_V2_OWNER_PENDING_HTTP:'0'},storage}),
  /abv2_operator_owner_gate_off/);
 const preview=make();
 const got=await preview(ctx);
 assert.equal(got.accountEmail,'owner@example.test');
 assert.equal(got.pending.length,1);
 assert.equal(got.pending[0].aCode,'ABCD02-GHFDX');
 assert.ok(!JSON.stringify(got).includes('FORBIDDEN'));
 assert.equal(calls.length,1);
 assert.equal(calls[0].scope.owner,owner);
 assert.equal(calls[0].scope.device,deviceId);
 assert.equal(calls[0].scope.connection,connectionId);
 const count=calls.length;
 const denied=[
  ()=>preview({...ctx,proof:null}),
  ()=>preview({...ctx,binding:{...binding,accountId:'other'}}),
 ];
 for(const fn of denied)await assert.rejects(fn(),/abv2_/);
 assert.equal(calls.length,count);
 enrollment={...enrollment,revokedAt:Date.now()};
 await assert.rejects(preview(ctx),/abv2_device_policy_denied/);
 enrollment={...enrollment,revokedAt:null,publicIdentityKey:'new'};
 await assert.rejects(preview(ctx),/abv2_device_policy_denied/);
 enrollment={...enrollment,publicIdentityKey:'key1'};
 device={...device,accountId:'other'};
 await assert.rejects(preview(ctx),/abv2_device_binding_mismatch/);
 device={...device,accountId:owner};
 policy={...policy,approvedCapabilities:[]};
 await assert.rejects(preview(ctx),/abv2_device_policy_denied/);
 policy={...policy,approvedCapabilities:['filesystem']};
 account={...account,emailVerified:false};
 await assert.rejects(preview(ctx),/abv2_verified_owner_required/);
 account={...account,emailVerified:true};
 connection={...connection,hardExpiresAt:Date.now()-1};
 await assert.rejects(preview(ctx),/abv2_device_connection_invalid/);
 connection={...connection,hardExpiresAt:Date.now()+300000,connectionId:'conn2'};
 const changed=await preview(ctx);
 assert.deepEqual(changed.pending,[]);
 assert.equal(calls.length,count,'new connection cannot reuse old indexed pending');
}finally{fs.rmSync(root,{recursive:true,force:true});}
console.log('GOLD_ABV2_SIGNED_DEVICE_PREVIEW_SCOPED_NO_B_NO_MUTATION=PASS');
