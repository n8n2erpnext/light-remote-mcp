import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createGoldWallModules} from '../../device-agent/gold-wall-modules.mjs';
import {changeGoldScopeSyncPolicy} from '../../device-agent/gold-memory-scope.mjs';
import {goldSyncIdentity,goldGrantReplica,goldAcceptReplicaInvite} from '../../device-agent/gold-memory-sync.mjs';
import {receiveGoldPeerRequest,signGoldPeerRequest,pollGoldPeer,allowGoldPeerHomeUrl,
  configureGoldPeerRoute,runGoldPeerRoutes} from '../../device-agent/gold-memory-peer.mjs';

const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gold-peer-g3-'));
const homeFile=path.join(temp,'home.sqlite'),replicaFile=path.join(temp,'replica.sqlite');
const accountId='test-one',homeDevice='arm-home',replicaDevice='windows-replica';
const m=createGoldWallModules({file:homeFile,scopeIdentity:{accountId,deviceId:homeDevice}});
let h,r;
try{
 m.configure({longMemory:true,codexBridge:false,expectedRevision:0});
 const scope=m.createMemoryScope({displayName:'P2P test synthetic only',captureMode:'manual'});
 const cp=m.appendScopedCheckpoint({scopeId:scope.scopeId,title:'Synthetic',body:'No real user data',source:'uat'});
 const homeSign=homeFile+'.device-ed25519-key',homeEnc=homeFile+'.device-x25519-key';
 const repSign=replicaFile+'.device-ed25519-key',repEnc=replicaFile+'.device-x25519-key';
 const homeIdentity=goldSyncIdentity(homeSign,homeEnc,{accountId,deviceId:homeDevice});
 const repIdentity=goldSyncIdentity(repSign,repEnc,{accountId,deviceId:replicaDevice});
 m.close();h=new DatabaseSync(homeFile);r=new DatabaseSync(replicaFile);
 assert.throws(()=>allowGoldPeerHomeUrl('http://127.0.0.1:5591'),/gold_peer_netbird_only/);
 assert.throws(()=>allowGoldPeerHomeUrl('http://example.com:5591'),/gold_peer_home_url_invalid/);
 assert.throws(()=>allowGoldPeerHomeUrl('http://100.94.184.141:5591/foo'),/gold_peer_home_url_invalid/);
 const url=allowGoldPeerHomeUrl('http://100.94.184.141:5591/');
 changeGoldScopeSyncPolicy(h,{accountId,deviceId:homeDevice,scopeId:scope.scopeId,syncPolicy:'selected_devices'});
 const invite=goldGrantReplica(h,homeSign,homeEnc,{accountId,deviceId:homeDevice,
   scopeId:scope.scopeId,peer:repIdentity,expectedFingerprint:repIdentity.fingerprint,ownerConfirmed:true});
 goldAcceptReplicaInvite(r,repSign,repEnc,{accountId,deviceId:replicaDevice,package:invite,
   expectedHomeFingerprint:homeIdentity.fingerprint,ownerConfirmed:true});
 const request=signGoldPeerRequest(repSign,{accountId,deviceId:replicaDevice,
   homeDeviceId:homeDevice,scopeId:scope.scopeId,action:'pull'});
 const bad=structuredClone(request);bad.signature='tampered';
 assert.throws(()=>receiveGoldPeerRequest(h,homeSign,homeEnc,{accountId,deviceId:homeDevice,request:bad}),/gold_peer_signature_invalid/);
 assert.throws(()=>receiveGoldPeerRequest(h,homeSign,homeEnc,{accountId,deviceId:homeDevice,
   request:signGoldPeerRequest(repSign,{accountId,deviceId:replicaDevice,
     homeDeviceId:homeDevice,scopeId:scope.scopeId,action:'pull',now:Date.now()-180000})}),/gold_peer_request_invalid/);
 const first=receiveGoldPeerRequest(h,homeSign,homeEnc,{accountId,deviceId:homeDevice,request});
 assert.equal(first.state,'frame');assert.ok(!JSON.stringify(first.frame).includes('No real user data'));
 assert.throws(()=>receiveGoldPeerRequest(h,homeSign,homeEnc,{accountId,deviceId:homeDevice,request}),/gold_peer_replayed_request/);
 assert.equal(configureGoldPeerRoute(r,{accountId,deviceId:replicaDevice,
   scopeId:scope.scopeId,homeUrl:url,enabled:true}).enabled,true);
 const mockFetch=async (_url,{body})=>{
   const req=JSON.parse(body);
   try{return new Response(JSON.stringify({ok:true,result:receiveGoldPeerRequest(h,homeSign,homeEnc,{
     accountId,deviceId:homeDevice,request:req})}),{status:200,headers:{'content-type':'application/json'}});}
   catch(e){return new Response(JSON.stringify({ok:false,error:e.message}),{status:e.status||403});}
 };
 const pulled=await pollGoldPeer(r,repSign,repEnc,{accountId,deviceId:replicaDevice,
   scopeId:scope.scopeId,homeDeviceId:homeDevice,homeUrl:url,fetchImpl:mockFetch});
 assert.equal(pulled.revision,1);
 assert.equal(pulled.ack,'acked');
 const replica=createGoldWallModules({file:replicaFile,scopeIdentity:{accountId,deviceId:replicaDevice}});
 try{replica.configure({longMemory:true,codexBridge:false,expectedRevision:0});assert.equal(replica.scopedHandoff({scopeId:scope.scopeId}).checkpoints[0].integrity,'home_ed25519_verified');
 assert.equal(replica.scopedHandoff({scopeId:scope.scopeId}).checkpoints[0].checkpointId,cp.checkpointId);}
 finally{replica.close();}
 const already=await pollGoldPeer(r,repSign,repEnc,{accountId,deviceId:replicaDevice,
   scopeId:scope.scopeId,homeDeviceId:homeDevice,homeUrl:url,fetchImpl:mockFetch});
 assert.equal(already.state,'up_to_date');
 // Background routes default disabled unless explicitly owner-enabled.
 configureGoldPeerRoute(r,{accountId,deviceId:replicaDevice,scopeId:scope.scopeId,
   homeUrl:url,enabled:false});
 console.log('GOLD_G3_P2P_SIGNED_NONCE_REPLAY_NETBIRD_ROUTE_CRYPTO_ACK_PASS');
}finally{
 try{m.close();}catch{}
 try{h?.close();}catch{}
 try{r?.close();}catch{}
 fs.rmSync(temp,{recursive:true,force:true});
}
