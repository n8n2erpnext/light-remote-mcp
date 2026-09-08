const crypto = require('node:crypto');
const publicKeys = require('../operator-public-keys.json');

const INFO = Buffer.from('gpt-vps-operator-envelope-v1');
function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function deriveKey(shared, requestId) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(requestId), INFO, 32));
}
function sealOperatorPayload(payload) {
  const kid = publicKeys.currentKid;
  const encodedPublic = publicKeys.keys?.[kid];
  if (!kid || !encodedPublic) throw new Error('operator_public_key_unavailable');
  const recipient = crypto.createPublicKey({ key: Buffer.from(encodedPublic, 'base64'), format: 'der', type: 'spki' });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const requestId = crypto.randomUUID();
  const iat = Date.now();
  const exp = iat + 60000;
  const aad = { version: 1, kid, requestId, iat, exp, purpose: 'gpt-vps-operator' };
  const shared = crypto.diffieHellman({ privateKey, publicKey: recipient });
  const key = deriveKey(shared, requestId);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(aad)));
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()]);
  return { ...aad,
    ephemeralPublicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    nonce: b64url(nonce), ciphertext: b64url(ciphertext), tag: b64url(cipher.getAuthTag())
  };
}
module.exports = { sealOperatorPayload };
