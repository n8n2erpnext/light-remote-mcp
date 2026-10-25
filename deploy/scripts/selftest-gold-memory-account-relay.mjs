import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {memoryRelay} from '../../operator-host/gold-memory-rendezvous.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gold-memory-relay-'));
const accountId='relayed-account',homeId='home-arm',replicaId='replica-win';
const devices=[
  {accountId,deviceId:homeId,state:'online'},
  {accountId,deviceId:replicaId,state:'online'},
  {accountId:'different-account',deviceId:'evil',state:'online'}
];
function call(deviceId,action,content={}) {
  return memoryRelay({accountId,deviceId,devices,payload:{action,...content}});
}
const home=createGoldWallModules({file:path.join(tmp,'home.sqlite'),
  scopeIdentity:{accountId,deviceId:homeId}});
const replica=createGoldWallModules({file:path.join(tmp,'replica.sqlite'),
  scopeIdentity:{accountId,deviceId:replicaId}});
try{
  home.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  replica.configure({longMemory:true,codexBridge:false,expectedRevision:0});
  const scope=home.createMemoryScope({displayName:'G3 encrypted relay'});
  const other=home.createMemoryScope({displayName:'isolated'});
  home.changeScopeSyncPolicy({scopeId:scope.scopeId,syncPolicy:'selected_devices'});
  const hi=home.syncIdentity(),ri=replica.syncIdentity();
  const grant=home.grantSyncReplica({scopeId:scope.scopeId,peer:ri,
    expectedFingerprint:ri.fingerprint,ownerConfirmed:true});
  replica.acceptSyncInvite({package:grant,expectedHomeFingerprint:hi.fingerprint,ownerConfirmed:true});
  for(let revision=1;revision<=2;revision++){
    const cp=home.appendScopedCheckpoint({scopeId:scope.scopeId,title:'Round '+revision,
      body:'Private sync checkpoint '+revision,source:'relay-selftest'});
    const next=home.nextSyncFrame({scopeId:scope.scopeId,replicaDeviceId:replicaId});
    assert.equal(next.frame.meta.revision,revision);
    assert.ok(!JSON.stringify(next.frame).includes('Private sync checkpoint'));
    assert.throws(()=>call('evil','push_frame',{frame:next.frame}),/memory_relay_device_not_enrolled/);
    assert.throws(()=>call(replicaId,'push_frame',{frame:next.frame}),/memory_relay_target_invalid/);
    assert.equal(call(homeId,'push_frame',{frame:next.frame}).queued,true);
    const fetched=call(replicaId,'pull_frames').items.find(x=>x.meta.scopeId===scope.scopeId&&
      x.meta.revision===revision);
    assert.ok(fetched);
    const accepted=replica.applySyncFrame({frame:fetched});
    assert.equal(accepted.status,'applied');
    assert.equal(call(replicaId,'push_ack',{ack:accepted.ack}).queued,true);
    const ack=call(homeId,'pull_acks').items.find(x=>x.revision===revision);
    assert.equal(home.applySyncAck({receipt:ack}).status,'acked');
    assert.equal(home.nextSyncFrame({scopeId:scope.scopeId,replicaDeviceId:replicaId}).state,'up_to_date');
    assert.equal(replica.scopedHandoff({scopeId:scope.scopeId}).checkpoints[0].checkpointId,cp.checkpointId);
  }
  assert.throws(()=>replica.scopedHandoff({scopeId:other.scopeId}),/gold_scope_not_found/);
  assert.equal(home.syncStatus({scopeId:scope.scopeId}).peers.find(p=>p.deviceId===replicaId).ackRevision,2);
  console.log('GOLD_MEMORY_E2EE_ACCOUNT_VOLATILE_RELAY_2_REVISIONS_ACK_SCOPE_ISOLATION_PASS');
}finally{
  home.close();replica.close();fs.rmSync(tmp,{recursive:true,force:true});
}
