import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const publicOut = process.argv[2] || 'operator-public-keys.json';
const privateOut = process.argv[3] || '/home/ubuntu/.config/gpt-vps-operator/operator.private.json';
const kid = `x25519-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex')}`;
const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
const pub = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
fs.mkdirSync(path.dirname(path.resolve(privateOut)), { recursive: true });
fs.writeFileSync(publicOut, JSON.stringify({ currentKid: kid, keys: { [kid]: pub } }, null, 2) + '\n', { mode: 0o644 });
fs.writeFileSync(privateOut, JSON.stringify({ currentKid: kid, keys: { [kid]: priv } }, null, 2) + '\n', { mode: 0o600 });
fs.chmodSync(privateOut, 0o600);
const fp = crypto.createHash('sha256').update(Buffer.from(pub, 'base64')).digest('hex');
console.log(JSON.stringify({ ok: true, kid, publicFingerprintSha256: fp, publicOut, privateOut }));
