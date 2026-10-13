import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  signFakeAbPacket,verifyFakeAbPacket,fakeApprovalDigest,
  makeFakeDeviceGrantState,evaluateFakeAbGrantLease
} from './synthetic-ab-grant-lease.mjs';

const t=1000000, SHA='f'.repeat(64);
function fixture(){
 const wall=crypto.generateKeyPairSync('ed25519');
 const issuer=crypto.generateKeyPairSync('ed25519');
 const rogue=crypto.generateKeyPairSync('ed25519');
 let now=t;
 const ids={ownerAccountId:'uat_owner_primary',accountId:'uat_owner_primary',
  deviceId:'uat_device_primary',agentId:'uat_agent_primary',deviceKeySha256:SHA};
 let state=makeFakeDeviceGrantState({...ids,
   wallPublicKey:wall.publicKey,issuerPublicKey:issuer.publicKey});
 const approval=(patch={})=>({
  kind:'fake_approval',requestId:'uat_request_primary',grantId:'uat_grant_primary',
  ...ids,connectionId:'uat_connection_primary',purpose:'device',
  createdAt:920000,requestExpiresAt:980000,approvedAt:950000,
  grantExpiresAt:1100000,absoluteExpiresAt:950000+86400000,grantRevision:1,
  ...patch
 });
 const signedApproval=(a=approval(),key=wall.privateKey)=>
   signFakeAbPacket('approval',key,a);
 const lease=(a=approval(),patch={})=>({
   kind:'fake_lease',approvalDigest:fakeApprovalDigest(a),
   requestId:a.requestId,grantId:a.grantId,ownerAccountId:a.ownerAccountId,
   accountId:a.accountId,deviceId:a.deviceId,agentId:a.agentId,
   connectionId:a.connectionId,deviceKeySha256:a.deviceKeySha256,
   purpose:a.purpose,generation:50,grantRevision:a.grantRevision,
   revocationRevision:0,notBefore:995000,expiresAt:1020000,...patch
 });
 const signedLease=(l=lease(),key=issuer.privateKey)=>signFakeAbPacket('lease',key,l);
 const revocation=(patch={})=>({
  kind:'fake_revocation',ownerAccountId:ids.ownerAccountId,accountId:ids.accountId,
  deviceId:ids.deviceId,grantId:'uat_grant_primary',revocationRevision:1,
  effectiveAt:995000,reason:'owner_revoke',...patch
 });
 const signedRevoke=(r=revocation(),key=issuer.privateKey)=>
   signFakeAbPacket('revocation',key,r);
 const run=(operation,extra={})=>evaluateFakeAbGrantLease(state,{
   operation,signedApproval:signedApproval(),signedLease:signedLease(),...extra
 },{wallPublicKey:wall.publicKey,issuerPublicKey:issuer.publicKey,
   timeSource:()=>now});
 const move=(operation,extra={})=>{
   const result=run(operation,extra);
   if(result.decision==='PROPOSE_DURABLE_STATE')state=result.next;
   return result;
 };
 return {wall,issuer,rogue,ids,approval,signedApproval,lease,signedLease,
  revocation,signedRevoke,run,move,state:()=>state,setState:s=>state=s,
  setNow:value=>now=value};
}
const denied=(r,reason)=>{
 assert.equal(r.decision,'DENY');assert.equal(r.reason,reason);
 assert.equal(r.physicalExecutionAuthorized,false);
};
const success=r=>{
 assert.equal(r.decision,'PROPOSE_DURABLE_STATE',r.reason);
 assert.equal(r.physicalExecutionAuthorized,false);
 assert.equal(r.requiresFsync,true);
 return r.next;
};
test('01 initialized fake grant root pins independent issuer and Wall keys',()=>{
 const f=fixture(),s=f.state();
 assert.match(s.wallPin,/^[a-f0-9]{64}$/);
 assert.match(s.issuerPin,/^[a-f0-9]{64}$/);
 assert.notEqual(s.wallPin,s.issuerPin);
 assert.equal(s.floorGeneration,0);
});
test('02 Wall approval Ed25519 signature verified and exact digest',()=>{
 const f=fixture(),a=f.approval(),signed=f.signedApproval(a);
 assert.deepEqual(verifyFakeAbPacket('approval',f.wall.publicKey,signed),a);
 assert.match(fakeApprovalDigest(a),/^[a-f0-9]{64}$/);
});
test('03 forged Wall signer rejected without any accepted grant',()=>{
 const f=fixture(),before=f.state();
 denied(f.run('accept',{signedApproval:f.signedApproval(f.approval(),f.rogue.privateKey)}),
  'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
 assert.deepEqual(f.state(),before);
});
test('04 forged service issuer lease rejected',()=>{
 const f=fixture();
 denied(f.run('accept',{signedLease:f.signedLease(f.lease(),f.rogue.privateKey)}),
  'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
});
test('05 Wall approval payload tamper rejected',()=>{
 const f=fixture(),pkt=f.signedApproval();
 pkt.payload={...pkt.payload,deviceId:'uat_device_attacker'};
 denied(f.run('accept',{signedApproval:pkt}),'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
});
test('06 service lease payload tamper rejected',()=>{
 const f=fixture(),pkt=f.signedLease();
 pkt.payload={...pkt.payload,generation:90};
 denied(f.run('accept',{signedLease:pkt}),'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
});
test('07 pending request is not an approved fixture',()=>{
 const f=fixture();
 assert.throws(()=>f.signedApproval(f.approval({kind:'fake_pending'})),/kind_invalid/);
});
test('08 approval past 10-minute request lifetime rejected',()=>{
 const f=fixture();
 assert.throws(()=>f.signedApproval(f.approval({requestExpiresAt:1600000})),/fake_ab_approval_invalid/);
});
test('09 approval after pairing expiry rejected',()=>{
 const f=fixture();
 assert.throws(()=>f.signedApproval(f.approval({approvedAt:981000})),/fake_ab_approval_invalid/);
});
test('10 absolute grant cannot exceed 24h from approval',()=>{
 const f=fixture();
 assert.throws(()=>f.signedApproval(f.approval({absoluteExpiresAt:950000+86400001})),/fake_ab_approval_invalid/);
});
test('11 team-member A/B purpose does not authorize direct device binding',()=>{
 const f=fixture();
 assert.throws(()=>f.signedApproval(f.approval({purpose:'team-member'})),/fake_device_proof_invalid/);
});
test('12 actor cannot borrow grant owned by another account',()=>{
 const f=fixture();
 assert.throws(()=>f.signedApproval(f.approval({accountId:'uat_member_other'})),/fake_direct_owner_mismatch/);
});
test('13 max offline lease duration is 30 seconds',()=>{
 const f=fixture();
 assert.throws(()=>f.signedLease(f.lease(f.approval(),{expiresAt:1026000})),/fake_short_lease_invalid/);
});
test('14 source of truth is both signed packets and same approvalDigest',()=>{
 const f=fixture();
 const a=f.approval({connectionId:'uat_connection_other'});
 denied(f.run('accept',{signedApproval:f.signedApproval(a)}),
  'LEASE_NOT_BOUND_TO_APPROVAL');
});
test('15 valid signed A/B grant and short lease accepted',()=>{
 const f=fixture(),next=success(f.move('accept'));
 assert.equal(next.floorGeneration,50);
 assert.equal(next.activeGrantId,'uat_grant_primary');
 assert.equal(next.activeApprovalDigest,fakeApprovalDigest(f.approval()));
});
test('16 active grant lease check requests durability but cannot execute OS',()=>{
 const f=fixture();f.move('accept');
 const r=f.move('check');success(r);
 assert.equal(r.reason,'SIGNED_FAKE_LEASE_CHECK_ONLY');
});
test('17 unaccepted command/lease check cannot start work',()=>{
 const f=fixture();denied(f.run('check'),'NOT_ACTIVE_APPROVED_GRANT');
});
test('18 tampered fingerprint inside persisted state cannot be silently reset',()=>{
 const f=fixture(),s={...f.state(),wallPin:'0'.repeat(64)};
 f.setState(s);denied(f.run('accept'),'PINNED_FAKE_ISSUER_MISMATCH');
});
test('19 changed device public identity rejected',()=>{
 const f=fixture(),a=f.approval({deviceKeySha256:'a'.repeat(64)});
 const l=f.lease(a);
 denied(f.run('accept',{signedApproval:f.signedApproval(a),signedLease:f.signedLease(l)}),
  'GRANT_TARGET_MISMATCH');
});
test('20 grant request and signed lease connection must match',()=>{
 const f=fixture(),l=f.lease(f.approval(),{connectionId:'uat_connection_attacker'});
 denied(f.run('accept',{signedLease:f.signedLease(l)}),
  'LEASE_NOT_BOUND_TO_APPROVAL');
});
test('21 expired offline lease denies despite caller-supplied old nowMs',()=>{
 const f=fixture();f.move('accept');f.setNow(1020000);
 denied(f.run('check',{nowMs:1000000}),
  'LEASE_EXPIRED_OUTSIDE_APPROVAL_OR_ABSOLUTE_LIMIT');
});
test('22 local clock rollback is fail-closed across persisted decision',()=>{
 const f=fixture();f.move('accept');f.setNow(t-1);
 denied(f.run('check'),'CLOCK_ROLLBACK_FAIL_CLOSED');
});
test('23 signed revocation raises floor and tombstones specific grant',()=>{
 const f=fixture();f.move('accept');
 const next=success(f.move('revoke',{signedRevocation:f.signedRevoke()}));
 assert.equal(next.revocationRevision,1);
 assert.deepEqual(next.revokedGrantIds,['uat_grant_primary']);
 assert.equal(next.activeGrantId,null);
});
test('24 replayed signed revocation never rolls floor back',()=>{
 const f=fixture();f.move('accept');f.move('revoke',{signedRevocation:f.signedRevoke()});
 denied(f.run('revoke',{signedRevocation:f.signedRevoke()}),'REVOCATION_NOT_MONOTONIC');
});
test('25 old signed lease permanently blocked once revoked even before expiry',()=>{
 const f=fixture();f.move('accept');f.move('revoke',{signedRevocation:f.signedRevoke()});
 denied(f.run('accept'),'GRANT_TOMBSTONED');
});
test('26 counterfeit revoke cannot close a valid grant',()=>{
 const f=fixture();f.move('accept');
 denied(f.run('revoke',{signedRevocation:f.signedRevoke(f.revocation(),f.rogue.privateKey)}),
  'REVOCATION_SIGNATURE_INVALID');
 assert.equal(f.state().activeGrantId,'uat_grant_primary');
});
test('27 future-dated revocation cannot prematurely close grant',()=>{
 const f=fixture();f.move('accept');
 const r=f.revocation({effectiveAt:t+1});
 denied(f.run('revoke',{signedRevocation:f.signedRevoke(r)}),
  'REVOCATION_WRONG_TARGET_OR_FUTURE');
});
test('28 old revocationRevision floor blocks otherwise valid different grant',()=>{
 const f=fixture();f.move('accept');f.move('revoke',{signedRevocation:f.signedRevoke()});
 const a=f.approval({requestId:'uat_request_second',grantId:'uat_grant_second',
  grantRevision:2});
 const l=f.lease(a,{generation:51,revocationRevision:0});
 denied(f.run('accept',{signedApproval:f.signedApproval(a),
   signedLease:f.signedLease(l)}),'STALE_REVOCATION_FLOOR');
});
test('29 signed new A/B approval + higher generation can rebind after revocation',()=>{
 const f=fixture();f.move('accept');f.move('revoke',{signedRevocation:f.signedRevoke()});
 const a=f.approval({requestId:'uat_request_second',grantId:'uat_grant_second',
  grantRevision:2});
 const l=f.lease(a,{generation:51,revocationRevision:1});
 const next=success(f.move('accept',{signedApproval:f.signedApproval(a),
  signedLease:f.signedLease(l)}));
 assert.equal(next.activeGrantId,'uat_grant_second');
 assert.equal(next.floorGeneration,51);
 assert.deepEqual(next.revokedGrantIds,['uat_grant_primary']);
});
test('30 same generation cannot silently replace the active grant',()=>{
 const f=fixture();f.move('accept');
 const a=f.approval({requestId:'uat_request_second',grantId:'uat_grant_second'});
 const l=f.lease(a,{generation:50});
 denied(f.run('accept',{signedApproval:f.signedApproval(a),
   signedLease:f.signedLease(l)}),'GENERATION_REUSE_WITH_DIFFERENT_GRANT');
});
test('31 state tampering that creates mismatched active identity denied',()=>{
 const f=fixture(),s={...f.state(),activeGrantId:'uat_grant_primary'};
 f.setState(s);denied(f.run('accept'),'CORRUPT_OR_UNINITIALIZED_GRANT_STATE');
});
test('32 no result authorizes physical execution',()=>{
 const f=fixture();
 const rs=[f.run('check'),f.move('accept'),f.move('check'),
  f.move('revoke',{signedRevocation:f.signedRevoke()})];
 for(const r of rs)assert.equal(r.physicalExecutionAuthorized,false);
});
test('33 expiry bound to grant independent of lease ttl',()=>{
 const f=fixture(),a=f.approval({grantExpiresAt:1005000});
 const l=f.lease(a,{notBefore:995000,expiresAt:1010000});
 denied(f.run('accept',{signedApproval:f.signedApproval(a),
  signedLease:f.signedLease(l)}),'LEASE_EXPIRED_OUTSIDE_APPROVAL_OR_ABSOLUTE_LIMIT');
});
test('34 unknown device action denied',()=>{
 const f=fixture();denied(f.run('exec'),'ACTION_UNSUPPORTED');
});
test('35 no trust from caller-asserted approval boolean',()=>{
 const f=fixture();
 denied(f.run('accept',{approved:true,signedApproval:{kind:'approved'},
   signedLease:{kind:'approved'}}),'APPROVAL_OR_LEASE_SIGNATURE_INVALID');
});
