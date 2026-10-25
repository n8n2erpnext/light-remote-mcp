import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {memoryDirectory,memoryInvites} from '../../operator-host/gold-memory-rendezvous.mjs';
const gateway=fs.readFileSync(new URL('../../plugin-server/device-public.mjs',import.meta.url),'utf8');
const actions=gateway.match(/const CHANNEL = new Set\(\[([\s\S]*?)\]\);/)?.[1]||'';
for(const action of ['memory-peers','memory-invites','memory-relay'])
  assert.ok(actions.includes("'"+action+"'"),'public_gateway_missing_signed_memory_action:'+action);
const accountId='rendezvous-account';
const devices=[
  {deviceId:'r-home',accountId,state:'online',displayName:'Home'},
  {deviceId:'r-replica',accountId,state:'online',displayName:'Replica'},
  {deviceId:'r-other',accountId:'different-account',state:'online'},
  {deviceId:'r-revoked',accountId,state:'revoked'}
];
function peer(deviceId){
  const sign=crypto.generateKeyPairSync('ed25519'),enc=crypto.generateKeyPairSync('x25519');
  const signPublicKey=sign.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const encPublicKey=enc.publicKey.export({format:'der',type:'spki'}).toString('base64');
  const fingerprint=crypto.createHash('sha256').update(signPublicKey+'\n'+encPublicKey)
    .digest('hex').slice(0,32);
  return {identity:{accountId,deviceId,signPublicKey,encPublicKey,fingerprint},
    sign:sign.privateKey};
}
const home=peer('r-home'),replica=peer('r-replica'),now=Date.now();
const listing=memoryDirectory({accountId,deviceId:'r-home',devices,identity:home.identity,now});
assert.deepEqual(listing.map(x=>x.deviceId),['r-home','r-replica']);
assert.equal(listing[0].memoryIdentity.fingerprint,home.identity.fingerprint);
assert.equal(listing[1].memoryIdentity,null);
memoryDirectory({accountId,deviceId:'r-replica',devices,identity:replica.identity,now});
assert.throws(()=>memoryDirectory({accountId,deviceId:'r-home',devices,
  identity:{...home.identity,accountId:'different-account'},now}),/memory_peer_identity_mismatch/);
assert.throws(()=>memoryDirectory({accountId,deviceId:'r-other',devices,
  identity:{...home.identity,deviceId:'r-other'},now}),/memory_peer_device_not_enrolled/);
const impostor=peer('r-home');
assert.throws(()=>memoryDirectory({accountId,deviceId:'r-home',devices,identity:impostor.identity,now}),
  /memory_peer_key_change_requires_reenrollment/);
const invite={protocol:'light-remote-memory-sync-v1',accountId,homeDeviceId:'r-home',
  toDeviceId:'r-replica',scopeId:crypto.randomUUID(),createdAt:now,
  homeSignPublicKey:home.identity.signPublicKey,homeEncPublicKey:home.identity.encPublicKey,
  peerSignPublicKey:replica.identity.signPublicKey,peerEncPublicKey:replica.identity.encPublicKey};
const pkg={invite,signature:crypto.sign(null,Buffer.from(JSON.stringify(invite)),home.sign).toString('base64')};
assert.throws(()=>memoryInvites({accountId,deviceId:'r-home',devices,
  payload:{action:'offer',package:{invite,signature:'bad-signature'}},now}),
  /memory_invite_signature_invalid/);
assert.throws(()=>memoryInvites({accountId,deviceId:'r-home',devices,
  payload:{action:'offer',package:{invite:{...invite,toDeviceId:'r-other'},signature:pkg.signature}},now}),
  /memory_invite_target_invalid/);
const offer=memoryInvites({accountId,deviceId:'r-home',devices,
  payload:{action:'offer',package:pkg},now});
const inbox=memoryInvites({accountId,deviceId:'r-replica',devices,payload:{action:'list'},now});
assert.equal(inbox.length,1);assert.equal(inbox[0].inviteId,offer.inviteId);
assert.deepEqual(memoryInvites({accountId,deviceId:'r-home',devices,payload:{action:'list'},now}),[]);
assert.throws(()=>memoryInvites({accountId,deviceId:'r-home',devices,
  payload:{action:'ack',inviteId:offer.inviteId},now}),/memory_invite_not_found/);
assert.equal(memoryInvites({accountId,deviceId:'r-replica',devices,
  payload:{action:'ack',inviteId:offer.inviteId},now}).acknowledged,true);
assert.equal(memoryInvites({accountId,deviceId:'r-replica',devices,payload:{action:'list'},now}).length,0);
console.log('GOLD_MEMORY_ACCOUNT_DEVICE_SIGNED_INVITATION_RENDEZVOUS_PASS');
