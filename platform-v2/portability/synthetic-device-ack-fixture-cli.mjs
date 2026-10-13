#!/usr/bin/env node
/**
 * UAT-ONLY fixture identity. Holds one fake Ed25519 device private key in RAM.
 * JSON-lines over stdin/stdout, no private key export, no real device traffic.
 * A separate verifier mode requires only public keys + signed packets.
 */
import crypto from 'node:crypto';
import readline from 'node:readline';
import {
  makeSyntheticDeviceLeaseAck,verifySyntheticDeviceLeaseAck
} from './synthetic-device-lease-ack.mjs';
import {fakeIssuerPublicKeyFingerprint} from './synthetic-outbox-lease-publisher.mjs';

const mode=process.argv.slice(2).join(' ');
if(!['--synthetic-only','--verify-only'].includes(mode) ||
  process.env.LR_RC50_UAT_ONLY!=='1'){
  process.stderr.write('fake_device_ack_cli_requires_isolated_uat\n');
  process.exit(3);
}
// Verifier-only subprocess NEVER instantiates a private device key.
const device=mode==='--synthetic-only'?crypto.generateKeyPairSync('ed25519'):null;
function pub(der){
  const k=crypto.createPublicKey({key:Buffer.from(der,'base64url'),
    format:'der',type:'spki'});
  if(k.asymmetricKeyType!=='ed25519' ||
     k.export({format:'der',type:'spki'}).toString('base64url')!==der)
    throw Error('noncanonical_public_key');
  return k;
}
function output(v){process.stdout.write(JSON.stringify(v)+'\n');}
function respond(body){
  if(body.action==='public' && device){
    output({devicePublicSpki:device.publicKey.export({type:'spki',
      format:'der'}).toString('base64url'),
      deviceKeySha256:fakeIssuerPublicKeyFingerprint(device.publicKey),
      productionAuthorized:false});
  }else if(body.action==='sign' && device){
    output({signedAck:makeSyntheticDeviceLeaseAck({
      signedLease:body.signedLease,issuerPublicKey:pub(body.issuerPublicSpki),
      devicePublicKey:device.publicKey,devicePrivateKey:device.privateKey,
      challenge:body.challenge
    }),physicalExecutionAuthorized:false});
  }else if(body.action==='verify' && !device){
    output(verifySyntheticDeviceLeaseAck({
      signedAck:body.signedAck,signedLease:body.signedLease,
      issuerPublicKey:pub(body.issuerPublicSpki),
      devicePublicKey:pub(body.devicePublicSpki),
      expected:body.expected
    }));
  }else{
    output({decision:'DENY',reason:'UNSUPPORTED_FAKE_ACTION',
      physicalExecutionAuthorized:false});
  }
}
for await(const line of readline.createInterface({input:process.stdin})){
  if(line.length>24000){output({decision:'DENY',reason:'TOO_LARGE'});continue;}
  try{respond(JSON.parse(line));}
  catch(e){output({decision:'DENY',reason:'FAKE_FIXTURE_INPUT_REJECTED'});}
}
