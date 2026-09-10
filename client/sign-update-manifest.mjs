import fs from 'node:fs';
import crypto from 'node:crypto';

const manifestFile=process.argv[2];
const signatureFile=process.argv[3]||`${manifestFile}.sig`;
const privateKeyFile=process.env.CLIENT_UPDATE_SIGNING_KEY_FILE;
if(!manifestFile)throw new Error('usage: node client/sign-update-manifest.mjs <manifest.json> [signature-file]');
if(!privateKeyFile)throw new Error('CLIENT_UPDATE_SIGNING_KEY_FILE_required');
const bytes=fs.readFileSync(manifestFile);
const key=fs.readFileSync(privateKeyFile,'utf8');
const signature=crypto.sign('sha256',bytes,key).toString('base64');
fs.writeFileSync(signatureFile,`${signature}\n`,{mode:0o644});
console.log(`signed_update_manifest=${manifestFile}`);
console.log(`signature_file=${signatureFile}`);
