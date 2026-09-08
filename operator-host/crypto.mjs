import fs from 'node:fs';
import crypto from 'node:crypto';

const INFO = Buffer.from('gpt-vps-operator-envelope-v1');

function b64urlToBuffer(value) {
  return Buffer.from(String(value).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function deriveKey(shared, requestId) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(requestId), INFO, 32));
}

export function loadPrivateKeySet(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!raw.currentKid || !raw.keys?.[raw.currentKid]) throw new Error('invalid_key_file');
  return raw;
}

export function decryptEnvelope(envelope, keyFile) {
  const { version, kid, requestId, iat, exp, ephemeralPublicKey, nonce, ciphertext, tag } = envelope || {};
  if (version !== 1 || !kid || !requestId || !iat || !exp || !ephemeralPublicKey || !nonce || !ciphertext || !tag) {
    throw new Error('invalid_envelope');
  }
  const keySet = loadPrivateKeySet(keyFile);
  const encodedPrivate = keySet.keys[kid];
  if (!encodedPrivate) throw new Error('unknown_kid');
  const privateKey = crypto.createPrivateKey({ key: Buffer.from(encodedPrivate, 'base64'), format: 'der', type: 'pkcs8' });
  const peerKey = crypto.createPublicKey({ key: Buffer.from(ephemeralPublicKey, 'base64'), format: 'der', type: 'spki' });
  const shared = crypto.diffieHellman({ privateKey, publicKey: peerKey });
  const key = deriveKey(shared, requestId);
  const aad = { version, kid, requestId, iat, exp, purpose: 'gpt-vps-operator' };
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, b64urlToBuffer(nonce));
  decipher.setAAD(Buffer.from(JSON.stringify(aad)));
  decipher.setAuthTag(b64urlToBuffer(tag));
  const plain = Buffer.concat([decipher.update(b64urlToBuffer(ciphertext)), decipher.final()]);
  return { payload: JSON.parse(plain.toString('utf8')), aad, kid, requestId };
}
