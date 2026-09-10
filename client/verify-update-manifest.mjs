import fs from 'node:fs';
import crypto from 'node:crypto';

const manifestFile=process.argv[2];
const signatureFile=process.argv[3]||`${manifestFile}.sig`;
const publicKeyFile=process.argv[4]||new URL('./update-public.pem',import.meta.url).pathname;
if(!manifestFile)throw new Error('usage: node client/verify-update-manifest.mjs <manifest.json> [signature-file] [public-key]');
const bytes=fs.readFileSync(manifestFile);
const signature=Buffer.from(fs.readFileSync(signatureFile,'utf8').trim(),'base64');
const key=fs.readFileSync(publicKeyFile,'utf8');
if(!crypto.verify('sha256',bytes,key,signature))throw new Error('invalid_update_manifest_signature');
const manifest=JSON.parse(bytes.toString('utf8'));
if(manifest.schemaVersion!==1)throw new Error('unsupported_update_manifest_schema');
console.log(`update_manifest_signature=PASS version=${manifest.version}`);
