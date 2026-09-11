import assert from 'node:assert/strict';
import { DevicePairingRegistry } from '../../operator-host/device-pairing-registry.mjs';

let now=1_000_000;const events=[];let connection={state:'connected',connectionId:'dc_pairing_00000001',hardExpiresAt:now+4*60*60*1000};
const registry=new DevicePairingRegistry({now:()=>now,ttlMs:180000,emit:e=>events.push(e)});
const args={accountId:'acct_pairing',deviceId:'dev_pairing',connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt};
const a1=registry.rotate(args);assert.match(a1.code,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);assert.equal(a1.ttlMs,180000);
assert.equal(events.at(-1).type,'device_pairing_a_rotated');assert.equal(JSON.stringify(events).includes(a1.code),false,'pairing_plaintext_must_not_be_emitted');
const a2=registry.rotate(args);assert.notEqual(a2.code,a1.code);assert.throws(()=>registry.redeem(a1.code,{connectionForDevice:()=>connection}),/pairing_code_not_found/);
const redeemed=registry.redeem(a2.code,{connectionForDevice:()=>connection});assert.equal(redeemed.deviceId,'dev_pairing');assert.equal(redeemed.connectionId,connection.connectionId);
assert.throws(()=>registry.redeem(a2.code,{connectionForDevice:()=>connection}),/pairing_code_not_found/);
const a3=registry.rotate(args);now+=180001;assert.throws(()=>registry.redeem(a3.code,{connectionForDevice:()=>connection}),/pairing_code_not_found|pairing_code_expired/);
now+=1;connection={state:'connected',connectionId:'dc_pairing_00000002',hardExpiresAt:now+4*60*60*1000};const a4=registry.rotate({...args,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt});
connection={state:'dormant',connectionId:connection.connectionId,hardExpiresAt:connection.hardExpiresAt};assert.throws(()=>registry.redeem(a4.code,{connectionForDevice:()=>connection}),/device_connection_required/);
connection={state:'connected',connectionId:'dc_pairing_00000003',hardExpiresAt:now+4*60*60*1000};const a5=registry.rotate({...args,connectionId:connection.connectionId,connectionExpiresAt:connection.hardExpiresAt});registry.invalidateDevice('dev_pairing','disconnect');assert.throws(()=>registry.redeem(a5.code,{connectionForDevice:()=>connection}),/pairing_code_not_found/);
console.log('v09-device-pairing-a-rotate=PASS');
console.log('v09-device-pairing-a-one-time=PASS');
console.log('v09-device-pairing-a-connection-bound=PASS');
console.log('v09-device-pairing-a-no-plaintext-event=PASS');
