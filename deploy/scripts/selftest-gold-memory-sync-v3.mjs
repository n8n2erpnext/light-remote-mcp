import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {appendGoldScopedCheckpoint,goldScopedHandoff,changeGoldScopeSyncPolicy} from '../../device-agent/gold-memory-scope.mjs';
import {goldSyncIdentity,goldGrantReplica,goldAcceptReplicaInvite,goldNextSyncFrame,
  goldApplySyncFrame,goldApplySyncAck,goldSyncStatus,goldRevokeReplica} from '../../device-agent/gold-memory-sync.mjs';

const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gold-g3-sync-'));
const home=path.join(temp,'arm'),replica=path.join(temp,'win');
fs.mkdirSync(home);fs.mkdirSync(replica);
const homeFile=path.join(home,'mod.sqlite'),repFile=path.join(replica,'mod.sqlite');
const hs=homeFile+'.device-ed25519-key',he=homeFile+'.device-x25519-key';
const rs=repFile+'.device-ed25519-key',re=repFile+'.device-x25519-key';
const owner='owner:one',armId='device-arm',winId='device-windows';
const m=createGoldWallModules({file:homeFile,scopeIdentity:{accountId:owner,deviceId:armId}});
let dh,dr;
try{
 assert.equal(fs.existsSync(homeFile),false);
 m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 const scope=m.createMemoryScope({displayName:'Light Remote Gold',captureMode:'auto'});
 const unrelated=m.createMemoryScope({displayName:'LightBI',captureMode:'manual'});
 const cp1=m.appendScopedCheckpoint({scopeId:scope.scopeId,kind:'checkpoint',title:'Gold checked',
   body:'Build complete on ARM',source:'verified-build',status:'test_passed'});
 const cpOther=m.appendScopedCheckpoint({scopeId:unrelated.scopeId,title:'LightBI independent',
   body:'Must not cross',source:'lightbi'});
 m.close();
 dh=new DatabaseSync(homeFile);dr=new DatabaseSync(repFile);
 const h=goldSyncIdentity(hs,he,{accountId:owner,deviceId:armId});
 const w=goldSyncIdentity(rs,re,{accountId:owner,deviceId:winId});
 assert.throws(()=>goldGrantReplica(dh,hs,he,{accountId:owner,deviceId:armId,scopeId:scope.scopeId,
   peer:w,expectedFingerprint:w.fingerprint,ownerConfirmed:true}),/gold_sync_local_only_policy/);
 changeGoldScopeSyncPolicy(dh,{accountId:owner,deviceId:armId,scopeId:scope.scopeId,syncPolicy:'selected_devices'});
 assert.throws(()=>goldGrantReplica(dh,hs,he,{accountId:owner,deviceId:armId,scopeId:scope.scopeId,
   peer:w,expectedFingerprint:'untrusted',ownerConfirmed:true}),/gold_sync_peer_fingerprint_unconfirmed/);
 const pkg=goldGrantReplica(dh,hs,he,{accountId:owner,deviceId:armId,scopeId:scope.scopeId,
   peer:w,expectedFingerprint:w.fingerprint,ownerConfirmed:true});
 assert.throws(()=>goldAcceptReplicaInvite(dr,rs,re,{accountId:owner,deviceId:winId,
   package:pkg,ownerConfirmed:true,expectedHomeFingerprint:'wrong'}),/gold_sync_home_fingerprint_unconfirmed/);
 const imported=goldAcceptReplicaInvite(dr,rs,re,{accountId:owner,deviceId:winId,
   package:pkg,ownerConfirmed:true,expectedHomeFingerprint:h.fingerprint});
 assert.equal(imported.revision,0);
 assert.throws(()=>goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:unrelated.scopeId,replicaDeviceId:winId}),/gold_sync_local_only_policy/);
 const sent1=goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId});
 assert.equal(sent1.state,'pending');
 assert.equal(sent1.reused,false);
 assert.equal(JSON.stringify(sent1.frame).includes('Build complete on ARM'),false,'encrypted frame must not disclose source');
 const again=goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId});
 assert.equal(again.reused,true);
 assert.deepEqual(again.frame,sent1.frame);
 const attacker=structuredClone(sent1.frame);
 attacker.ciphertext=attacker.ciphertext.slice(0,-6)+'AAAAAA';
 assert.throws(()=>goldApplySyncFrame(dr,rs,re,{accountId:owner,deviceId:winId,
   frame:attacker}),/gold_sync_frame_signature_invalid/);
 assert.throws(()=>goldApplySyncFrame(dr,rs,re,{accountId:'other',deviceId:winId,
   frame:sent1.frame}),/gold_sync_wrong_account_or_recipient/);
 const result1=goldApplySyncFrame(dr,rs,re,{accountId:owner,deviceId:winId,frame:sent1.frame});
 assert.equal(result1.status,'applied');assert.equal(result1.integrity,'home_ed25519_verified');
 assert.equal(goldScopedHandoff(dr,{accountId:owner,scopeId:scope.scopeId}).revision,1);
 assert.equal(goldScopedHandoff(dr,{accountId:owner,scopeId:scope.scopeId}).checkpoints[0].checkpointId,cp1.checkpointId);
 assert.equal(goldApplySyncFrame(dr,rs,re,{accountId:owner,deviceId:winId,frame:sent1.frame}).status,'duplicate');
 const invalidAck={...result1.ack,signature:'broken'};
 assert.throws(()=>goldApplySyncAck(dh,{accountId:owner,deviceId:armId,
   receipt:invalidAck}),/gold_sync_ack_signature_invalid/);
 const received=goldApplySyncAck(dh,{accountId:owner,deviceId:armId,receipt:result1.ack});
 assert.equal(received.status,'acked');assert.equal(received.revision,1);
 assert.equal(goldApplySyncAck(dh,{accountId:owner,deviceId:armId,receipt:result1.ack}).status,'duplicate');
 assert.equal(goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId}).state,'up_to_date');
 const cp2=appendGoldScopedCheckpoint(dh,hs,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,title:'Mac test',body:'Another change verified',source:'uat-test'});
 const second=goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId});
 assert.equal(second.frame.meta.revision,2);
 dr.close();dr=new DatabaseSync(repFile); // receiver restarted, old valid local key still works
 const result2=goldApplySyncFrame(dr,rs,re,{accountId:owner,deviceId:winId,frame:second.frame});
 assert.equal(result2.status,'applied');assert.equal(result2.revision,2);
 assert.equal(goldApplySyncAck(dh,{accountId:owner,deviceId:armId,receipt:result2.ack}).revision,2);
 assert.equal(goldScopedHandoff(dr,{accountId:owner,scopeId:scope.scopeId}).checkpoints[0].checkpointId,cp2.checkpointId);
 assert.equal(goldScopedHandoff(dr,{accountId:owner,scopeId:scope.scopeId}).checkpoints[0].integrity,'home_ed25519_verified');
 assert.throws(()=>goldScopedHandoff(dr,{accountId:owner,scopeId:unrelated.scopeId}),/gold_scope_not_found/);
 const status=goldSyncStatus(dh,{accountId:owner,deviceId:armId,scopeId:scope.scopeId});
 assert.equal(status.peers[0].ackRevision,2);assert.equal(status.peers[0].behind,0);
 assert.equal(status.localRevision,2);
 assert.equal(goldSyncStatus(dr,{accountId:owner,deviceId:winId,scopeId:scope.scopeId}).isHome,false);
 assert.throws(()=>appendGoldScopedCheckpoint(dr,rs,{accountId:owner,deviceId:winId,
   scopeId:scope.scopeId,title:'Hijack',body:'No',source:'tamper'}),/gold_scope_home_only/);
 if(process.platform!=='win32')assert.equal(fs.statSync(re).mode&0o077,0,'private encryption key must be 0600');
 else assert.ok(fs.existsSync(re),'Windows private key must exist under enforced owner-only ACL');
 assert.throws(()=>goldRevokeReplica(dh,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId}),/gold_sync_owner_confirmation_required/);
 assert.equal(goldRevokeReplica(dh,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId,ownerConfirmed:true}).status,'revoked');
 assert.throws(()=>goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId}),/gold_sync_scope_member_not_authorized/);
 const regrant=goldGrantReplica(dh,hs,he,{accountId:owner,deviceId:armId,scopeId:scope.scopeId,
   peer:w,expectedFingerprint:w.fingerprint,ownerConfirmed:true});
 assert.equal(regrant.invite.grantEpoch,2);
 goldAcceptReplicaInvite(dr,rs,re,{accountId:owner,deviceId:winId,package:regrant,
   expectedHomeFingerprint:h.fingerprint,ownerConfirmed:true});
 const replay1=goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId});
 assert.equal(replay1.frame.meta.revision,1,'regrant resets ack and starts reconciliation at r1');
 assert.notEqual(replay1.frame.meta.grantId,sent1.frame.meta.grantId);
 const resumed1=goldApplySyncFrame(dr,rs,re,{accountId:owner,deviceId:winId,frame:replay1.frame});
 assert.equal(resumed1.status,'duplicate','existing replica recognizes its signed record');
 assert.equal(goldApplySyncAck(dh,{accountId:owner,deviceId:armId,receipt:resumed1.ack}).revision,1);
 const replay2=goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId});
 const resumed2=goldApplySyncFrame(dr,rs,re,{accountId:owner,deviceId:winId,frame:replay2.frame});
 assert.equal(resumed2.status,'duplicate');
 assert.equal(goldApplySyncAck(dh,{accountId:owner,deviceId:armId,receipt:resumed2.ack}).revision,2);
 assert.equal(goldNextSyncFrame(dh,hs,he,{accountId:owner,deviceId:armId,
   scopeId:scope.scopeId,replicaDeviceId:winId}).state,'up_to_date');
 console.log('GOLD_G3_E2EE_HOME_REPLICA_OUTBOX_SIGNED_ACK_RESTART_SCOPE_ISOLATION_PASS');
}finally{
 try{m.close()}catch{}
 try{dh?.close()}catch{}
 try{dr?.close()}catch{}
 fs.rmSync(temp,{recursive:true,force:true});
}
