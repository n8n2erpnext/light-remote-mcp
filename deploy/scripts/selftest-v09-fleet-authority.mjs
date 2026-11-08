import {FleetAuthorityRegistry,FleetAuthorityError} from '../../operator-host/fleet-authority-registry.mjs';

let now=1_780_000_000_000;
const events=[];
const registry=new FleetAuthorityRegistry({ttlMs:60_000,now:()=>now,emit:e=>events.push(e)});
function expectError(fn,message,status){let caught=null;try{fn();}catch(e){caught=e;}if(!(caught instanceof FleetAuthorityError)||caught.message!==message||caught.status!==status)throw new Error(`expected_${message}_${status}`);}

const keyA='a'.repeat(64),keyB='b'.repeat(64);
const first=registry.issue({accountId:'acct',mainDeviceId:'dev-a',deviceId:'dev-a',publicKeySha256:keyA,entitlementId:'ent-vip',moduleVersion:'0.9.0-rc.6'});
if(!first.token||first.lease.deviceId!=='dev-a'||first.lease.expiresAt-now!==60_000)throw new Error('fleet_issue_failed');
if(registry.verify(first.token,{accountId:'acct',deviceId:'dev-a',publicKeySha256:keyA}).leaseId!==first.lease.leaseId)throw new Error('fleet_verify_failed');
expectError(()=>registry.verify(first.token,{accountId:'acct',deviceId:'dev-a',publicKeySha256:keyB}),'fleet_authority_binding_mismatch',403);
expectError(()=>registry.issue({accountId:'acct',mainDeviceId:'dev-b',deviceId:'dev-a',publicKeySha256:keyA}),'fleet_main_device_mismatch',403);
const second=registry.issue({accountId:'acct',mainDeviceId:'dev-a',deviceId:'dev-a',publicKeySha256:keyA});
expectError(()=>registry.verify(first.token,{accountId:'acct',deviceId:'dev-a',publicKeySha256:keyA}),'fleet_authority_required',401);
if(registry.verify(second.token,{accountId:'acct',deviceId:'dev-a',publicKeySha256:keyA}).leaseId!==second.lease.leaseId)throw new Error('fleet_rotate_new_token_failed');
registry.invalidateDevice('dev-a','main_changed');
expectError(()=>registry.verify(second.token,{accountId:'acct',deviceId:'dev-a',publicKeySha256:keyA}),'fleet_authority_required',401);
const expiring=registry.issue({accountId:'acct',mainDeviceId:'dev-a',deviceId:'dev-a',publicKeySha256:keyA});
now+=60_001;
expectError(()=>registry.verify(expiring.token,{accountId:'acct',deviceId:'dev-a',publicKeySha256:keyA}),'fleet_authority_required',401);
if(events.some(e=>JSON.stringify(e).includes(first.token)||JSON.stringify(e).includes(second.token)))throw new Error('fleet_token_leaked_to_events');
console.log('v09-fleet-authority-binding=PASS');
console.log('v09-fleet-authority-rotation=PASS');
console.log('v09-fleet-authority-expiry=PASS');
console.log('v09-fleet-authority-no-token-audit=PASS');
