import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {GoldGuestSignedOutboundPg}
 from '../../operator-host/pro-share-guest-outbound-pg.mjs';

const k=crypto.generateKeyPairSync('ed25519');
const signer={privateKey:k.privateKey,
 publicEncoded:k.publicKey.export({format:'der',type:'spki'}).toString('base64')};
const pool={connect:async()=>{throw Error('unexpected_live_pg_access')}};
const disabled=new GoldGuestSignedOutboundPg({pool,env:{}});
await assert.rejects(disabled.prepare({
 jobId:'0af5a9c1-8050-478a-83d1-5e26821cf101',
 processIntent:{type:'process-start',script:'true',
  cwd:'/tmp',shell:'sh',timeoutMs:1000}
}),/guest_outbound_prepare_disabled/);
await assert.rejects(disabled.markAttempt({
 jobId:'0af5a9c1-8050-478a-83d1-5e26821cf101',
 commandId:'cmd_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
}),/guest_outbound_prepare_disabled/);
assert.throws(()=>new GoldGuestSignedOutboundPg({
 pool,env:{LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE:'1'}
}),/guest_outbound_dependencies_off/);
const flags=Object.fromEntries([
 'LR_GOLD_PRO_SHARE_CORE','LR_GOLD_PRO_SHARE_GUEST_SLOTS',
 'LR_GOLD_PRO_SHARE_GUEST_QUEUE',
 'LR_GOLD_PRO_SHARE_GUEST_PAYLOAD_STAGE',
 'LR_GOLD_PRO_SHARE_GUEST_M4_BRIDGE',
 'LR_GOLD_PRO_SHARE_GUEST_AGENT_PROTOCOL',
 'LR_GOLD_PRO_SHARE_GUEST_TICKET_ISSUE',
 'LR_GOLD_PRO_SHARE_GUEST_OUTBOUND_PREPARE'
].map(k=>[k,'1']));
assert.throws(()=>new GoldGuestSignedOutboundPg({
 pool,env:flags,signer,assertFreshAuthority:async()=>null
}),/guest_outbound_epoch_signer_or_authority_missing/);
assert.throws(()=>new GoldGuestSignedOutboundPg({
 pool,env:{...flags,OPERATOR_EXECUTION_EPOCH_ENABLED:'1'},
 signer:{...signer,publicEncoded:'not-enrollment-signer'},
 assertFreshAuthority:async()=>null
}),/guest_outbound_enrollment_signer_mismatch/);
const source=fs.readFileSync(
 'operator-host/pro-share-guest-outbound-pg.mjs','utf8');
assert.match(source,/lr_gold_execution_command_issuance/);
assert.match(source,/guest_outbound_attempt_lost_race/);
assert.match(source,/guest_outbound_epoch_or_permission_changed/);
assert.match(source,/resubmissionAllowed:false/);
assert.match(source,/deviceSignerPublicKey!==this.signerPublicKey/);
console.log('GOLD_P2I4C3C2B2_OUTBOUND_DEFAULT_OFF_EPOCH_SIGNER_FENCE=PASS');
console.log('GOLD_P2I4C3C2B2_ONE_ID_UNKNOWN_NO_AUTOMATIC_RETRY_SOURCE=PASS');
