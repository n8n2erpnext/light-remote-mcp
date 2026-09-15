import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createOperatorCryptoFixture} from './selftest-crypto-fixture.mjs';
import {deviceChannelMessage} from '../../lib/device-proof.mjs';

const root=new URL('../..',import.meta.url).pathname,currentVersion=fs.readFileSync(`${root}/VERSION`,'utf8').trim();
const agentSource=fs.readFileSync(`${root}/device-agent/operator-agent.mjs`,'utf8');
if(!agentSource.includes('if(state.identity?.privateKey){delete state.identity')||!agentSource.includes('external_identity_rotation_required'))throw new Error('hard_remove_identity_rotation_missing');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-main-migration-'));
const socket=path.join(dir,'operator.sock'),stateDir=path.join(dir,'state'),logDir=path.join(dir,'log');
fs.mkdirSync(stateDir,{recursive:true});fs.mkdirSync(logDir,{recursive:true});
const fixture=createOperatorCryptoFixture(stateDir);
const child=spawn(process.execPath,[`${root}/operator-host/executor.mjs`],{cwd:root,env:{...process.env,OPERATOR_SOCKET:socket,OPERATOR_STATE_DIR:stateDir,OPERATOR_LOG_DIR:logDir,OPERATOR_KEY_FILE:fixture.privateFile,OPERATOR_ACCOUNT_PLAN:'free'},stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<100&&!fs.existsSync(socket);i++)await sleep(40);
if(!fs.existsSync(socket))throw new Error('executor_not_ready');function request(method,target,body,headers={}){return new Promise((resolve,reject)=>{
  const data=body==null?null:Buffer.from(JSON.stringify(body)),h={...headers};
  if(data){h['content-type']='application/json';h['content-length']=data.length;}
  const req=http.request({socketPath:socket,method,path:target,headers:h},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{let json={};try{json=JSON.parse(text)}catch{}resolve({status:res.statusCode,json});});});
  req.on('error',reject);if(data)req.write(data);req.end();
});}
async function enroll(label){
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
  const begun=await request('POST','/v1/enrollments/begin',{publicIdentityKey,displayName:label,platform:'linux',architecture:'x64',agentVersion:currentVersion,fingerprintSummary:`${label}-fingerprint`,capabilities:['filesystem'],policyProfile:'test'});
  if(begun.status!==200)throw new Error(`${label}_begin_failed:${begun.status}:${begun.json.error}`);
  const approved=await request('POST','/v1/enrollments/approve',{code:begun.json.enrollment.deviceCode,accountId:'self-hosted-local',approvedCapabilities:['filesystem'],policyProfile:'test'});
  if(approved.status!==200)throw new Error(`${label}_approve_failed:${approved.status}:${approved.json.error}`);
  const deviceId=approved.json.approval.deviceId;
  const signed=(action,payload)=>{const timestamp=Date.now(),nonce=crypto.randomBytes(18).toString('base64url');return{deviceId,timestamp,nonce,payload,signature:crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey).toString('base64url')};};
  return{deviceId,publicIdentityKey,signed,certificate:approved.json.approval.certificate};
}try{
  const email=`migration-${crypto.randomBytes(4).toString('hex')}@example.test`,password=`Mig-${crypto.randomBytes(20).toString('base64url')}`;
  let r=await request('POST','/v1/accounts/register',{email,password,ownerProofVerified:true});
  if(r.status!==201)throw new Error(`account_register_failed:${r.status}:${r.json.error}`);
  const token=r.json.token;
  const a=await enroll('Device A'),b=await enroll('Device B');
  r=await request('POST','/v1/admin/accounts/self-hosted-local/entitlement',{plan:'pro',durationDays:30,sourceRef:'main-migration-selftest'});
  if(r.status!==200||r.json.entitlements?.fleetWall!==true)throw new Error('pro_fleet_entitlement_missing');

  r=await request('POST','/v1/accounts/main-device',{deviceId:a.deviceId},{'x-light-account-session':token});
  if(r.status!==409||r.json.error!=='main_device_offline')throw new Error('offline_device_became_main');
  for(const device of [a,b]){
    r=await request('POST','/v1/device-channel/connect',device.signed('connect',{nodeId:device.deviceId,agentVersion:currentVersion,requestedLeaseMs:2*60*60*1000,reconnectGraceMs:30*60*1000}));
    if(r.status!==200||r.json.connection?.state!=='connected')throw new Error('main_candidate_connect_failed');
    r=await request('POST','/v1/device-channel/poll',device.signed('poll',{nodeId:device.deviceId,agentVersion:currentVersion,sessionCeiling:2,draining:false,capabilities:['filesystem'],policyRevision:1,waitMs:0}));
    if(r.status!==200||r.json.channel?.node?.state!=='online')throw new Error('main_candidate_poll_failed');
  }

  r=await request('POST',`/v1/accounts/devices/${a.deviceId}/update`,{force:false},{'x-light-account-session':token});
  if(r.status!==428||r.json.error!=='force_update_confirmation_required')throw new Error('force_update_confirmation_not_required');
  r=await request('POST',`/v1/accounts/devices/${a.deviceId}/update`,{force:true},{'x-light-account-session':token});
  if(r.status!==200||r.json.forced!==true||r.json.maintenance?.accepted!==true||r.json.maintenance?.source!=='account-portal')throw new Error(`account_force_update_queue_failed:${r.status}:${r.json.error}`);
  const updateMaintenance=r.json.maintenance;
  r=await request('POST','/v1/device-channel/poll',a.signed('poll',{nodeId:a.deviceId,agentVersion:currentVersion,sessionCeiling:2,draining:false,capabilities:['filesystem'],policyRevision:1,waitMs:0}));
  const updateCommand=r.json.channel?.command;
  if(r.status!==200||updateCommand?.payload?.type!=='update'||updateCommand?.payload?.update?.op!=='request'||updateCommand?.payload?.update?.source!=='account-portal')throw new Error('account_force_update_command_contract_failed');
  r=await request('POST','/v1/device-channel/result',a.signed('result',{commandId:updateCommand.commandId,status:'ok',exitCode:0,stdout:'',stderr:'',durationMs:1,data:{accepted:true,source:'account-portal',mode:'apply',transport:'helper-trigger'}}));
  if(r.status!==200||r.json.job?.status!=='ok'||r.json.job?.resultData?.mode!=='apply')throw new Error('account_force_update_result_failed');
  r=await request('GET',`/v1/sessions/${updateMaintenance.sessionId}?agentId=${encodeURIComponent(updateMaintenance.agentId)}`);
  if(r.status!==200||r.json.session?.state!=='closed')throw new Error('account_force_update_session_not_auto_closed');

  r=await request('POST','/v1/accounts/main-device',{deviceId:a.deviceId},{'x-light-account-session':token});
  if(r.status!==200||r.json.account?.mainDeviceId!==a.deviceId||r.json.account?.fleetProvisioning?.state!=='starting')throw new Error('set_main_a_failed');
  r=await request('POST','/v1/device-channel/fleet-intent',a.signed('fleet-intent',{}));
  if(r.status!==200||r.json.fleet?.desired!==true||r.json.account?.fleetProvisioning?.state!=='configuring')throw new Error('main_a_intent_missing');
  r=await request('POST','/v1/device-channel/fleet-intent',b.signed('fleet-intent',{}));
  if(r.status!==200||r.json.fleet?.desired!==false)throw new Error('non_main_b_intent_should_be_false');
  r=await request('POST','/v1/device-channel/fleet-authority',a.signed('fleet-authority',{moduleVersion:'0.9.0-rc.6'}));
  if(r.status!==200||!r.json.authority?.token||r.json.account?.fleetProvisioning?.state!=='ready')throw new Error('main_a_authority_missing');
  const tokenA=r.json.authority.token;
  r=await request('POST','/v1/device-channel/fleet-status',a.signed('fleet-status',{status:'online',moduleVersion:'0.9.0-rc.6',port:5492}));
  if(r.status!==401||r.json.error!=='fleet_authority_required')throw new Error('fleet_status_without_authority_not_rejected');
  r=await request('POST','/v1/device-channel/fleet-status',a.signed('fleet-status',{fleetToken:tokenA,status:'online',moduleVersion:'0.9.0-rc.6',port:5492}));
  if(r.status!==200||r.json.account?.fleetProvisioning?.state!=='online')throw new Error('main_a_online_status_missing');
  r=await request('POST','/v1/accounts/main-device',{deviceId:b.deviceId},{'x-light-account-session':token});
  if(r.status!==200||r.json.account?.mainDeviceId!==b.deviceId||r.json.account?.fleetProvisioning?.deviceId!==b.deviceId||r.json.account?.fleetProvisioning?.state!=='starting')throw new Error('set_main_b_failed');
  r=await request('POST','/v1/device-channel/fleet-intent',a.signed('fleet-intent',{}));
  if(r.status!==200||r.json.fleet?.desired!==false||r.json.fleet?.reason!=='not_main_device')throw new Error('old_main_a_intent_survived');
  r=await request('POST','/v1/device-channel/fleet-devices',a.signed('fleet-devices',{fleetToken:tokenA}));
  if(r.status!==403||r.json.error!=='fleet_main_device_required')throw new Error('old_main_a_fleet_authority_survived');
  r=await request('POST','/v1/device-channel/fleet-authority',a.signed('fleet-authority',{moduleVersion:'0.9.0-rc.6'}));
  if(r.status!==403||r.json.error!=='fleet_main_device_required')throw new Error('old_main_a_reacquired_authority');

  r=await request('POST','/v1/device-channel/fleet-intent',b.signed('fleet-intent',{}));
  if(r.status!==200||r.json.fleet?.desired!==true||r.json.account?.fleetProvisioning?.state!=='configuring')throw new Error('new_main_b_intent_missing');
  r=await request('POST','/v1/device-channel/fleet-authority',b.signed('fleet-authority',{moduleVersion:'0.9.0-rc.6'}));
  if(r.status!==200||!r.json.authority?.token||r.json.authority?.lease?.deviceId!==b.deviceId||r.json.account?.fleetProvisioning?.state!=='ready')throw new Error('new_main_b_authority_missing');
  const tokenB=r.json.authority.token;
  r=await request('POST','/v1/device-channel/fleet-status',b.signed('fleet-status',{fleetToken:tokenB,status:'online',moduleVersion:'0.9.0-rc.6',port:5492}));
  if(r.status!==200||r.json.account?.fleetProvisioning?.state!=='online')throw new Error('new_main_b_online_status_missing');
  r=await request('POST','/v1/device-channel/fleet-devices',b.signed('fleet-devices',{fleetToken:tokenB}));
  if(r.status!==200||r.json.mainDeviceId!==b.deviceId||!r.json.devices?.some(d=>d.deviceId===a.deviceId)||!r.json.devices?.some(d=>d.deviceId===b.deviceId))throw new Error('new_main_b_fleet_view_failed');
  r=await request('POST','/v1/device-channel/fleet-device-policy',b.signed('fleet-device-policy',{fleetToken:tokenB,deviceId:a.deviceId,policyProfile:'fleet-test',approvedCapabilities:['filesystem']}));
  if(r.status!==200||r.json.policy?.deviceId!==a.deviceId||r.json.policy?.policyProfile!=='fleet-test')throw new Error('new_main_b_policy_mutation_failed');
  r=await request('POST','/v1/device-channel/fleet-device-policy',a.signed('fleet-device-policy',{fleetToken:tokenA,deviceId:b.deviceId,policyProfile:'stale-main',approvedCapabilities:['filesystem']}));
  if(r.status!==403||r.json.error!=='fleet_main_device_required')throw new Error('old_main_policy_mutation_survived');
  r=await request('GET','/v1/devices');
  const viewA=r.json.devices?.find(d=>d.deviceId===a.deviceId),viewB=r.json.devices?.find(d=>d.deviceId===b.deviceId);
  if(!viewA||!viewB||viewA.publicIdentityKey!==a.publicIdentityKey||viewB.publicIdentityKey!==b.publicIdentityKey)throw new Error('main_migration_changed_device_identity');

  r=await request('POST','/v1/accounts/main-device/clear',{}, {'x-light-account-session':token});
  if(r.status!==200||r.json.account?.mainDeviceId!==null||r.json.account?.fleetProvisioning!==null)throw new Error('clear_main_after_migration_failed');
  r=await request('POST','/v1/device-channel/fleet-devices',b.signed('fleet-devices',{fleetToken:tokenB}));
  if(r.status!==403||r.json.error!=='fleet_main_device_required')throw new Error('main_clear_did_not_revoke_b');

  r=await request('POST',`/v1/accounts/devices/${a.deviceId}/remove`,{}, {'x-light-account-session':token});
  if(r.status!==200||r.json.removed?.deviceId!==a.deviceId)throw new Error('hard_remove_a_failed');
  r=await request('GET','/v1/accounts/devices',null,{'x-light-account-session':token});
  if(r.status!==200||r.json.devices?.some(d=>d.deviceId===a.deviceId)||!r.json.devices?.some(d=>d.deviceId===b.deviceId))throw new Error('hard_remove_a_registry_not_purged');
  r=await request('POST','/v1/device-channel/fleet-intent',a.signed('fleet-intent',{}));
  if(r.status!==404||r.json.error!=='device_binding_not_found')throw new Error('hard_remove_a_binding_survived');
  r=await request('POST','/v1/accounts/devices/arm-local/remove',{}, {'x-light-account-session':token});
  if(r.status!==409||r.json.error!=='integrated_hub_device_not_removable')throw new Error('integrated_hub_remove_not_rejected');
  console.log('v09-device-hard-remove=PASS');
  console.log('v09-account-force-update-helper-lane=PASS');

  console.log('v09-main-migration-a-to-b=PASS');
  console.log('v09-main-migration-old-authority-revoked=PASS');
  console.log('v09-main-migration-new-authority-issued=PASS');
  console.log('v09-main-migration-provisioning-state-machine=PASS');
  console.log('v09-main-migration-no-reenroll=PASS');
  console.log('v09-main-migration-no-fallback=PASS');
} finally {
  try{child.kill('SIGTERM');}catch{}
  await sleep(100);fs.rmSync(dir,{recursive:true,force:true});
}