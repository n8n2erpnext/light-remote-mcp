import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {memoryRelay} from '../../operator-host/gold-memory-rendezvous.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-replica-evidence-'));
const owner='owner-evidence-a',arm='arm-evidence',win='windows-evidence';
const homePath=path.join(root,'home','wall.sqlite'),winPath=path.join(root,'windows','wall.sqlite');
fs.mkdirSync(path.dirname(homePath),{recursive:true});
fs.mkdirSync(path.dirname(winPath),{recursive:true});
let home=createGoldWallModules({file:homePath,scopeIdentity:{accountId:owner,deviceId:arm}});
let replica=createGoldWallModules({file:winPath,scopeIdentity:{accountId:owner,deviceId:win}});
try{
  home.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  replica.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const scope=home.createMemoryScope({displayName:'Test Windows-to-ARM evidence',captureMode:'manual'});
  home.changeScopeSyncPolicy({scopeId:scope.scopeId,syncPolicy:'selected_devices'});
  const h=home.syncIdentity(),w=replica.syncIdentity();
  const invite=home.grantSyncReplica({scopeId:scope.scopeId,peer:w,
    expectedFingerprint:w.fingerprint,ownerConfirmed:true});
  replica.acceptSyncInvite({package:invite,expectedHomeFingerprint:h.fingerprint,ownerConfirmed:true});
  const event=replica.queueReplicaEvidence({scopeId:scope.scopeId,eventType:'test_receipt',
    title:'Windows verified UAT',body:'Synthetic Windows test result sent to ARM',
    source:'windows-build:test-1',evidence:['signed-test-receipt']});
  assert.equal(event.state,'pending');
  let pending=replica.pendingReplicaEvidence();
  assert.equal(pending.length,1);
  assert.equal(JSON.stringify(pending[0]).includes('Synthetic Windows test result'),false,
    'E2EE event body must not be visible to relay');
  const roster=[{deviceId:arm,accountId:owner,state:'online'},
    {deviceId:win,accountId:owner,state:'online'}];
  const relayPush=memoryRelay({accountId:owner,deviceId:win,devices:roster,
    payload:{action:'push_evidence',evidence:pending[0]}});
  assert.equal(relayPush.queued,true);
  const relayed=memoryRelay({accountId:owner,deviceId:arm,devices:roster,
    payload:{action:'pull_evidence'}});
  assert.equal(relayed.items.length,1);
  assert.equal(relayed.items[0].meta.eventId,event.eventId);
  assert.throws(()=>memoryRelay({accountId:'another-account',deviceId:win,
    devices:roster,payload:{action:'push_evidence',evidence:pending[0]}}),
    /memory_relay_device_not_enrolled/);
  assert.throws(()=>home.acceptReplicaEvidence({...pending[0],signature:'tampered'}),
    /gold_evidence_signature_invalid/);
  assert.throws(()=>home.acceptReplicaEvidence({...pending[0],meta:{...pending[0].meta,accountId:'different'}}),
    /gold_evidence_address_invalid/);
  const applied=home.acceptReplicaEvidence(relayed.items[0]);
  assert.equal(applied.status,'committed');
  assert.equal(applied.revision,1);
  assert.equal(applied.integrity,'home_ed25519_signed');
  assert.equal(home.scopedHandoff({scopeId:scope.scopeId}).revision,1);
  assert.equal(home.scopedHandoff({scopeId:scope.scopeId}).checkpoints[0].status,'claimed');
  assert.equal(home.scopedHandoff({scopeId:scope.scopeId}).checkpoints[0].source,'replica:'+win+':windows-build:test-1');
  assert.equal(home.acceptReplicaEvidence(pending[0]).status,'duplicate');
  assert.equal(home.scopedHandoff({scopeId:scope.scopeId}).revision,1);
  assert.throws(()=>replica.applyReplicaEvidenceAck({...applied.ack,signature:'bad'}),
    /gold_evidence_ack_signature_invalid/);
  assert.equal(memoryRelay({accountId:owner,deviceId:arm,devices:roster,
    payload:{action:'push_evidence_ack',evidence_ack:applied.ack}}).queued,true);
  const gotAcks=memoryRelay({accountId:owner,deviceId:win,devices:roster,
    payload:{action:'pull_evidence_acks'}});
  assert.equal(gotAcks.items.some(x=>x.eventId===event.eventId),true);
  const accepted=replica.applyReplicaEvidenceAck(applied.ack);
  assert.equal(accepted.status,'acked');
  assert.equal(accepted.homeRevision,1);
  assert.equal(replica.applyReplicaEvidenceAck(applied.ack).status,'duplicate');
  assert.equal(replica.pendingReplicaEvidence().length,0);
  // Home-origin checkpoint is independently replicated back, no second Home.
  const framed=home.nextSyncFrame({scopeId:scope.scopeId,replicaDeviceId:win});
  assert.equal(framed.state,'pending');
  const received=replica.applySyncFrame({frame:framed.frame});
  assert.equal(received.status,'applied');
  assert.equal(replica.scopedHandoff({scopeId:scope.scopeId}).revision,1);
  assert.equal(replica.scopedHandoff({scopeId:scope.scopeId}).checkpoints[0].checkpointId,
    applied.ack.checkpointId);
  assert.equal(home.applySyncAck({receipt:received.ack}).revision,1);
  // Test durable encrypted outbox survives close/reopen and duplicate delivery.
  replica.queueReplicaEvidence({scopeId:scope.scopeId,eventType:'manual_note',
    title:'Windows offline note',body:'Locally durable, retained without cloud',
    source:'windows:offline',evidence:[]});
  replica.close();
  replica=createGoldWallModules({file:winPath,scopeIdentity:{accountId:owner,deviceId:win}});
  pending=replica.pendingReplicaEvidence();
  assert.equal(pending.length,1);
  const second=home.acceptReplicaEvidence(pending[0]);
  assert.equal(second.revision,2);
  assert.equal(home.acceptReplicaEvidence(pending[0]).status,'duplicate');
  replica.applyReplicaEvidenceAck(second.ack);
  assert.equal(replica.pendingReplicaEvidence().length,0);
  // Revoked member cannot contribute event despite locally queued frame.
  const third=replica.queueReplicaEvidence({scopeId:scope.scopeId,eventType:'manual_note',
    title:'Stale event must be rejected',body:'Do not accept after revoke',
    source:'windows:stale'});
  assert.ok(third.eventId);
  const stale=replica.pendingReplicaEvidence()[0];
  home.revokeSyncReplica({scopeId:scope.scopeId,replicaDeviceId:win,ownerConfirmed:true});
  assert.throws(()=>home.acceptReplicaEvidence(stale),/gold_evidence_membership_denied/);
  console.log('GOLD_REPLICA_TO_HOME_E2EE_SIGNED_TYPED_EVENT_ATOMIC_COMMIT_REPLAY_RESTART_REVOCATION_PASS');
}finally{try{home.close()}catch{}try{replica.close()}catch{}
 fs.rmSync(root,{recursive:true,force:true})}
