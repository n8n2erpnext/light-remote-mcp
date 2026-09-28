import crypto from 'node:crypto';
import { EnrollmentRegistry } from '../../operator-host/enrollment-registry.mjs';
import { FleetRouter, FleetError } from '../../operator-host/fleet-router.mjs';
import { deviceChannelMessage } from '../../lib/device-proof.mjs';

let now=1_900_000_000_000;
const events=[];
const enrollment=new EnrollmentRegistry({now:()=>now,emit:e=>events.push(e)});
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const begun=enrollment.begin({publicIdentityKey,displayName:'AMD test',platform:'linux',architecture:'x64',capabilities:['filesystem','git']});
const approved=enrollment.approve({code:begun.deviceCode,accountId:'self-hosted-local',approvedCapabilities:['filesystem','git']});
const deviceId=approved.deviceId,nodeId=deviceId;
function signed(action,payload){
  const timestamp=now,nonce=crypto.randomBytes(18).toString('base64url');
  const signature=crypto.sign(null,Buffer.from(deviceChannelMessage({deviceId,action,timestamp,nonce,payload})),privateKey).toString('base64url');
  return {deviceId,timestamp,nonce,signature};
}
const hello={nodeId,sessionCeiling:2,draining:false,capabilities:['filesystem','git']};
const proof=signed('poll',hello);
const verified=enrollment.verifyChannel(proof,'poll',hello);
if(verified.binding.deviceId!==deviceId)throw new Error('channel_binding_failed');
try{enrollment.verifyChannel(proof,'poll',hello);throw new Error('channel_replay_accepted');}catch(e){if(e.message!=='device_proof_replay')throw e;}
console.log('v08-device-channel-signature-replay=PASS');

const fleet=new FleetRouter({now:()=>now,emit:e=>events.push(e),channelTtlMs:20_000,commandLeaseMs:5_000});
let polled=fleet.poll({accountId:'self-hosted-local',deviceId,nodeId,sessionCeiling:2,draining:false,capabilities:['filesystem','git']});
if(polled.state!=='idle'||polled.node.state!=='online'||polled.node.sessionCeiling!==2)throw new Error('fleet_channel_online_failed');
const command=fleet.enqueue({accountId:'self-hosted-local',deviceId,nodeId,jobId:'job_test_1234567890',payload:{type:'exec',script:'printf ok'}});
polled=fleet.poll({accountId:'self-hosted-local',deviceId,nodeId,sessionCeiling:2,capabilities:['filesystem','git']});
if(polled.state!=='command'||polled.command.commandId!==command.commandId||polled.command.attempts!==1)throw new Error('fleet_dispatch_failed');
now+=5_100;
polled=fleet.poll({accountId:'self-hosted-local',deviceId,nodeId,sessionCeiling:2,capabilities:['filesystem','git']});
if(polled.command?.commandId!==command.commandId||polled.command.attempts!==2)throw new Error('fleet_redelivery_failed');
fleet.complete({accountId:'self-hosted-local',deviceId,nodeId,commandId:command.commandId});
now+=19_500;
if(fleet.view(nodeId).state!=='online')throw new Error('fleet_complete_presence_refresh_failed');
console.log('v08-command-lease-redelivery=PASS');
console.log('v11-fleet-complete-refreshes-presence=PASS');

const late=fleet.enqueue({accountId:'self-hosted-local',deviceId,nodeId,jobId:'job_late_1234567890',payload:{type:'desktop',desktop:{op:'observe'}}});
polled=fleet.poll({accountId:'self-hosted-local',deviceId,nodeId,sessionCeiling:2,capabilities:['filesystem','git']});
if(polled.command?.commandId!==late.commandId)throw new Error('fleet_late_dispatch_failed');
now+=20_100;
if(fleet.view(nodeId).state!=='online')throw new Error('fleet_inflight_presence_lost');
const abandoned=fleet.abandon(late.commandId,'remote_result_timeout'),receipt=fleet.receipt(late.commandId);
if(!abandoned?.abandoned||!receipt?.duplicate||!receipt?.abandoned||receipt.abandonReason!=='remote_result_timeout')throw new Error('fleet_abandoned_receipt_missing');
if(fleet.view(nodeId).state!=='offline')throw new Error('fleet_abandoned_stale_node_should_be_offline');
polled=fleet.poll({accountId:'self-hosted-local',deviceId,nodeId,sessionCeiling:2,capabilities:['filesystem','git']});
if(polled.state!=='idle'||polled.node.state!=='online')throw new Error('fleet_repoll_after_abandon_failed');
console.log('v11-fleet-inflight-presence=PASS');
console.log('v11-fleet-late-result-receipt=PASS');

fleet.setOwnerDrain(nodeId,true);
try{fleet.enqueue({accountId:'self-hosted-local',deviceId,nodeId,jobId:'job_test_2234567890',payload:{}});throw new Error('drain_enqueue_accepted');}catch(e){if(!(e instanceof FleetError)||e.message!=='target_node_draining')throw e;}
fleet.setOwnerDrain(nodeId,false);
now+=20_100;
try{fleet.assertRoutable(nodeId,{accountId:'self-hosted-local',deviceId});throw new Error('offline_route_accepted');}catch(e){if(e.message!=='target_node_offline')throw e;}
console.log('v08-drain-offline-no-fallback=PASS');
if(!events.some(e=>e.type==='node_command_redelivered')||!events.some(e=>e.type==='node_drain_changed'))throw new Error('fleet_audit_events_missing');
console.log('v08-fleet-audit-attribution=PASS');
