import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EnrollmentRegistry, EnrollmentError } from '../../operator-host/enrollment-registry.mjs';
import { deviceHeartbeatMessage } from '../../lib/device-proof.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-enrollment-registry-'));
const stateFile=path.join(dir,'enrollments.json'), signerFile=path.join(dir,'signer.json');
let now=1_800_000_000_000;
const events=[];
const registry=new EnrollmentRegistry({stateFile,signerFile,ttlMs:600000,now:()=>now,emit:e=>events.push(e)});
const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
const publicIdentityKey=publicKey.export({format:'der',type:'spki'}).toString('base64');
const begin=registry.begin({publicIdentityKey,displayName:'Test Device',platform:'linux',architecture:'arm64',agentVersion:'0.7.0-test',fingerprintSummary:'test/linux/arm64',capabilities:['git','docker'],policyProfile:'owner-test'});
if(!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(begin.deviceCode)) throw new Error('device_code_format_failed');
if(begin.activationUrl.includes(begin.deviceCode)||!begin.activationUrl.includes(begin.enrollmentId)) throw new Error('activation_url_leaks_code_or_misses_id');
const disk=fs.readFileSync(stateFile,'utf8');
if(disk.includes(begin.deviceCode)||disk.includes('PRIVATE KEY')) throw new Error('enrollment_state_contains_secret_material');
try{registry.approve({code:begin.deviceCode,accountId:'self-hosted-local',approvedCapabilities:[],policyProfile:'owner-test'});throw new Error('empty_capabilities_accepted');}catch(e){if(!(e instanceof EnrollmentError)||e.message!=='approved_capability_not_requested')throw e;}
try{registry.approve({code:begin.deviceCode,accountId:'self-hosted-local',approvedCapabilities:['sudo-on-demand'],policyProfile:'owner-test'});throw new Error('capability_escalation_accepted');}catch(e){if(e.message!=='approved_capability_not_requested')throw e;}
const approval=registry.approve({code:begin.deviceCode,accountId:'self-hosted-local',approvedCapabilities:['git'],policyProfile:'owner-test'});
try{registry.approve({code:begin.deviceCode,accountId:'self-hosted-local',approvedCapabilities:['git']});throw new Error('device_code_reused');}catch(e){if(e.status!==404)throw e;}
try{registry.poll({enrollmentId:begin.enrollmentId,pollToken:'wrong-token-aaaaaaaaaaaaaaaaaaaaaa'});throw new Error('wrong_poll_token_accepted');}catch(e){if(e.status!==401)throw e;}
const polled=registry.poll({enrollmentId:begin.enrollmentId,pollToken:begin.pollToken});
if(polled.state!=='approved'||polled.deviceId!==approval.deviceId||polled.approvedCapabilities.join(',')!=='git') throw new Error('approved_poll_failed');
const signer=crypto.createPublicKey({key:Buffer.from(polled.signer.publicKey,'base64'),format:'der',type:'spki'});
if(!crypto.verify(null,Buffer.from(JSON.stringify(polled.certificate)),signer,Buffer.from(polled.certificateSignature,'base64url'))) throw new Error('certificate_signature_invalid');
const timestamp=now, nonce=crypto.randomBytes(18).toString('base64url'), capabilities=['git'];
const message=deviceHeartbeatMessage({deviceId:polled.deviceId,timestamp,nonce,capabilities});
const signature=crypto.sign(null,Buffer.from(message),privateKey).toString('base64url');
registry.verifyHeartbeat({deviceId:polled.deviceId,timestamp,nonce,capabilities,signature});
try{registry.verifyHeartbeat({deviceId:polled.deviceId,timestamp,nonce,capabilities,signature});throw new Error('heartbeat_replay_accepted');}catch(e){if(e.message!=='device_proof_replay')throw e;}
const nonce2=crypto.randomBytes(18).toString('base64url');
const badCaps=['docker'];
const badSig=crypto.sign(null,Buffer.from(deviceHeartbeatMessage({deviceId:polled.deviceId,timestamp,nonce:nonce2,capabilities:badCaps})),privateKey).toString('base64url');
try{registry.verifyHeartbeat({deviceId:polled.deviceId,timestamp,nonce:nonce2,capabilities:badCaps,signature:badSig});throw new Error('heartbeat_capability_escalation_accepted');}catch(e){if(e.status!==403)throw e;}
now+=61_000;
const nonce3=crypto.randomBytes(18).toString('base64url');
const oldSig=crypto.sign(null,Buffer.from(deviceHeartbeatMessage({deviceId:polled.deviceId,timestamp,nonce:nonce3,capabilities})),privateKey).toString('base64url');
try{registry.verifyHeartbeat({deviceId:polled.deviceId,timestamp,nonce:nonce3,capabilities,signature:oldSig});throw new Error('expired_heartbeat_accepted');}catch(e){if(e.message!=='device_proof_expired')throw e;}
const reloaded=new EnrollmentRegistry({stateFile,signerFile,ttlMs:600000,now:()=>now});
if(reloaded.binding(polled.deviceId).publicKeySha256!==polled.certificate.publicKeySha256) throw new Error('binding_reload_failed');
if((fs.statSync(signerFile).mode & 0o777)!==0o600) throw new Error('signer_permissions_not_0600');
console.log('enrollment-code-one-time=PASS');
console.log('enrollment-secret-storage=PASS');
console.log('enrollment-capability-subset=PASS');
console.log('enrollment-certificate-signature=PASS');
console.log('device-heartbeat-proof-replay=PASS');
console.log('device-heartbeat-no-escalation=PASS');
const limitDir=fs.mkdtempSync(path.join(os.tmpdir(),'gpt-enrollment-source-limit-'));
const limited=new EnrollmentRegistry({stateFile:path.join(limitDir,'state.json'),signerFile:path.join(limitDir,'signer.json'),ttlMs:600000,now:()=>now});
for(let i=0;i<3;i++){const kp=crypto.generateKeyPairSync('ed25519');limited.begin({publicIdentityKey:kp.publicKey.export({format:'der',type:'spki'}).toString('base64'),displayName:`Source ${i}`,platform:'linux',architecture:'x64',capabilities:['git'],sourceHash:'a'.repeat(64)});}
try{const kp=crypto.generateKeyPairSync('ed25519');limited.begin({publicIdentityKey:kp.publicKey.export({format:'der',type:'spki'}).toString('base64'),displayName:'Source 4',platform:'linux',architecture:'x64',capabilities:['git'],sourceHash:'a'.repeat(64)});throw new Error('source_limit_not_enforced');}catch(e){if(e.message!=='enrollment_source_limit'||e.status!==429)throw e;}
console.log('enrollment-source-limit=PASS');
fs.rmSync(limitDir,{recursive:true,force:true});
console.log('enrollment-persistence=PASS');
fs.rmSync(dir,{recursive:true,force:true});
