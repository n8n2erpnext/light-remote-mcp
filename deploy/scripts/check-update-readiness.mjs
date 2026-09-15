import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {clientCompatibility,compareVersion,minimumSupportedVersion,parseVersion} from '../../lib/version-compat.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const get=(name,fallback=null)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
const manifestFile=path.resolve(get('--manifest',path.join(repo,'channels/beta/client-update.json'))),signatureFile=path.resolve(get('--signature',`${manifestFile}.sig`)),publicKeyFile=path.resolve(get('--public-key',path.join(repo,'client/update-public.pem'))),serverVersion=get('--server-version',fs.readFileSync(path.join(repo,'VERSION'),'utf8').trim()),exact=args.includes('--exact-current');
const policy=JSON.parse(fs.readFileSync(path.join(repo,'client/update-channel-policy.json'),'utf8')),manifestBytes=fs.readFileSync(manifestFile),manifest=JSON.parse(manifestBytes),signature=Buffer.from(fs.readFileSync(signatureFile,'utf8').trim(),'base64'),publicPem=fs.readFileSync(publicKeyFile,'utf8'),key=crypto.createPublicKey(publicPem);
if(!crypto.verify('sha256',manifestBytes,key,signature))throw new Error('update_readiness_signature_invalid');
if(manifest.schemaVersion!==1||manifest.channel!==policy.channel||!parseVersion(manifest.version))throw new Error('update_readiness_manifest_invalid');
if(!parseVersion(serverVersion))throw new Error('update_readiness_server_version_invalid');
const minimum=minimumSupportedVersion(serverVersion,{backwardReleases:policy.backwardReleases});
if(compareVersion(manifest.version,minimum)<0)throw new Error(`update_readiness_version_too_old:${manifest.version}:minimum=${minimum}`);
if(exact&&compareVersion(manifest.version,serverVersion)!==0)throw new Error(`update_readiness_not_current:${manifest.version}:current=${serverVersion}`);
for(const platform of policy.requiredPlatforms){
  const artifact=manifest.artifacts?.[platform];if(!artifact)throw new Error(`update_readiness_artifact_missing:${platform}`);
  if(policy.requireHttps&&!/^https:\/\//i.test(String(artifact.url||'')))throw new Error(`update_readiness_artifact_url_not_https:${platform}`);
  if(!/^[a-f0-9]{64}$/i.test(String(artifact.sha256||'')))throw new Error(`update_readiness_artifact_sha_invalid:${platform}`);
  if(!Number.isSafeInteger(Number(artifact.size))||Number(artifact.size)<=0)throw new Error(`update_readiness_artifact_size_invalid:${platform}`);
}
const spki=key.export({format:'der',type:'spki'}),keySha=crypto.createHash('sha256').update(spki).digest('hex'),compat=clientCompatibility(serverVersion,manifest.version,{backwardReleases:policy.backwardReleases});
console.log(`update_readiness=PASS`);console.log(`server_version=${serverVersion}`);console.log(`minimum_supported_client=${minimum}`);console.log(`signed_update_version=${manifest.version}`);console.log(`signed_update_platforms=${policy.requiredPlatforms.join(',')}`);console.log(`update_public_key_sha256=${keySha}`);console.log(`signed_update_compatible=${compat.supported}`);
