import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {validateSignedUpdateManifest} from '../../lib/update-readiness.mjs';
import {compareVersion,parseVersion} from '../../lib/version-compat.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const get=(name,fallback=null)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const has=name=>args.includes(name);
const manifestFile=get('--manifest'),signatureFile=get('--signature',manifestFile?`${manifestFile}.sig`:null);
if(!manifestFile||!signatureFile)throw new Error('usage: node deploy/scripts/promote-client-update-channel.mjs --manifest <file> [--signature <file>] [--apply] [--skip-remote-verify]');
const publicKeyFile=path.resolve(get('--public-key',path.join(repo,'client/update-public.pem')));
const channelDir=path.resolve(get('--channel-dir',path.join(repo,'channels/beta')));
const serverVersion=get('--server-version',fs.readFileSync(path.join(repo,'VERSION'),'utf8').trim());
const policy=JSON.parse(fs.readFileSync(path.join(repo,'client/update-channel-policy.json'),'utf8'));
const manifestBytes=fs.readFileSync(path.resolve(manifestFile)),signatureText=fs.readFileSync(path.resolve(signatureFile),'utf8'),publicKeyPem=fs.readFileSync(publicKeyFile,'utf8');
const validated=validateSignedUpdateManifest({manifestBytes,signatureText,publicKeyPem,serverVersion,policy,exact:true});

async function verifyRemote(platform,artifact){
  let response;try{response=await fetch(artifact.url,{redirect:'follow',headers:{'user-agent':'light-remote-update-promotion/1'}});}catch(error){throw new Error(`update_promotion_remote_fetch_failed:${platform}:${error.message}`);}
  if(!response.ok||!response.body)throw new Error(`update_promotion_remote_fetch_failed:${platform}:http_${response.status}`);
  const hash=crypto.createHash('sha256');let size=0;
  for await(const chunk of response.body){const bytes=Buffer.from(chunk);size+=bytes.length;hash.update(bytes);}
  if(size!==Number(artifact.size))throw new Error(`update_promotion_remote_size_mismatch:${platform}:${size}:${artifact.size}`);
  const digest=hash.digest('hex');if(digest!==String(artifact.sha256).toLowerCase())throw new Error(`update_promotion_remote_sha_mismatch:${platform}`);
  console.log(`remote_artifact=PASS platform=${platform} bytes=${size} sha256=${digest}`);
}

fs.mkdirSync(channelDir,{recursive:true});
const currentFile=path.join(channelDir,'client-update.json'),currentSignature=path.join(channelDir,'client-update.json.sig');
let current=null,currentBytes=null;if(fs.existsSync(currentFile)){
  currentBytes=fs.readFileSync(currentFile);if(!fs.existsSync(currentSignature))throw new Error('update_promotion_current_signature_missing');
  const currentSig=Buffer.from(fs.readFileSync(currentSignature,'utf8').trim(),'base64'),key=crypto.createPublicKey(publicKeyPem);
  if(!currentSig.length||!crypto.verify('sha256',currentBytes,key,currentSig))throw new Error('update_promotion_current_signature_invalid');
  try{current=JSON.parse(currentBytes.toString('utf8'));}catch{throw new Error('update_promotion_current_manifest_invalid');}
}
if(current?.version){
  if(!parseVersion(current.version))throw new Error('update_promotion_current_version_invalid');
  const cmp=compareVersion(validated.manifest.version,current.version);
  if(cmp<0)throw new Error(`update_promotion_rollback_rejected:${validated.manifest.version}<${current.version}`);
  if(cmp===0){
    if(currentBytes.equals(manifestBytes)){console.log(`update_promotion=ALREADY_CURRENT version=${validated.manifest.version}`);process.exit(0);}
    throw new Error(`update_promotion_same_version_content_mismatch:${validated.manifest.version}`);
  }
}
if(!has('--skip-remote-verify'))for(const platform of policy.requiredPlatforms)await verifyRemote(platform,validated.manifest.artifacts[platform]);
console.log(`update_promotion_readiness=PASS version=${validated.manifest.version} platforms=${policy.requiredPlatforms.join(',')}`);
if(!has('--apply')){console.log('update_promotion=DRY_RUN');process.exit(0);}
const tmpManifest=path.join(channelDir,`.client-update.json.${process.pid}.tmp`),tmpSignature=path.join(channelDir,`.client-update.json.sig.${process.pid}.tmp`);
fs.writeFileSync(tmpManifest,manifestBytes,{mode:0o644});fs.writeFileSync(tmpSignature,signatureText.trim()+'\n',{mode:0o644});
fs.renameSync(tmpSignature,currentSignature);fs.renameSync(tmpManifest,currentFile);
console.log(`update_promotion=APPLIED version=${validated.manifest.version}`);
console.log(`channel_manifest=${currentFile}`);console.log(`channel_signature=${currentSignature}`);
