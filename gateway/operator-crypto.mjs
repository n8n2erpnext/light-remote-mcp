import crypto from 'node:crypto';
import fs from 'node:fs';

const INFO = Buffer.from('gpt-vps-operator-envelope-v1');

function loadPublicKeys() {
  const file = process.env.OPERATOR_PUBLIC_KEYS_FILE;
  const raw = process.env.OPERATOR_PUBLIC_KEYS_JSON || (file ? fs.readFileSync(file, 'utf8') : '');
  if (!raw) throw new Error('operator_public_key_unavailable');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('operator_public_keys_json_invalid'); }
  if (!parsed?.currentKid || !parsed?.keys?.[parsed.currentKid]) throw new Error('operator_public_keys_json_invalid');
  return parsed;
}

function deriveKey(shared, requestId) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(requestId), INFO, 32));
}

export function sealOperatorPayload(payload) {
  const publicKeys = loadPublicKeys();
  const kid = publicKeys.currentKid;
  const recipient = crypto.createPublicKey({
    key: Buffer.from(publicKeys.keys[kid], 'base64'), format: 'der', type: 'spki'
  });
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const requestId = crypto.randomUUID();
  const iat = Date.now(), exp = iat + 60000;
  const aad = { version:1, kid, requestId, iat, exp, purpose:'gpt-vps-operator' };
  const shared = crypto.diffieHellman({ privateKey, publicKey:recipient });
  const key = deriveKey(shared, requestId);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(aad)));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload))), cipher.final()
  ]);
  return {
    ...aad,
    ephemeralPublicKey: publicKey.export({ format:'der', type:'spki' }).toString('base64'),
    nonce: nonce.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url')
  };
}
