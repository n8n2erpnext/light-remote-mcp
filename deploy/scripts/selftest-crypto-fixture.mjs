import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const INFO=Buffer.from('gpt-vps-operator-envelope-v1');
function deriveKey(shared,requestId){return Buffer.from(crypto.hkdfSync('sha256',shared,Buffer.from(requestId),INFO,32));}
export function createOperatorCryptoFixture(dir){
  const kid=`selftest-${crypto.randomBytes(6).toString('hex')}`;
  const {publicKey,privateKey}=crypto.generateKeyPairSync('x25519');
  const pub=publicKey.export({format:'der',type:'spki'}).toString('base64');
  const priv=privateKey.export({format:'der',type:'pkcs8'}).toString('base64');
  fs.mkdirSync(dir,{recursive:true});
  const privateFile=path.join(dir,'operator.private.json');
  fs.writeFileSync(privateFile,JSON.stringify({currentKid:kid,keys:{[kid]:priv}}),{mode:0o600});
  fs.chmodSync(privateFile,0o600);
  function seal(payload){
    const recipient=crypto.createPublicKey({key:Buffer.from(pub,'base64'),format:'der',type:'spki'});
    const ephemeral=crypto.generateKeyPairSync('x25519');
    const requestId=crypto.randomUUID(),iat=Date.now(),exp=iat+60000;
    const aad={version:1,kid,requestId,iat,exp,purpose:'gpt-vps-operator'};
    const shared=crypto.diffieHellman({privateKey:ephemeral.privateKey,publicKey:recipient});
    const key=deriveKey(shared,requestId),nonce=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',key,nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(aad)));
    const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))),cipher.final()]);
    return {...aad,ephemeralPublicKey:ephemeral.publicKey.export({format:'der',type:'spki'}).toString('base64'),nonce:nonce.toString('base64url'),ciphertext:ciphertext.toString('base64url'),tag:cipher.getAuthTag().toString('base64url')};
  }
  return {kid,privateFile,seal};
}
