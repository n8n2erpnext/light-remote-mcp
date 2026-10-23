/*
 * P2 owner step-up grant signing. The signer is *only* called after a
 * successful owner credential recheck in authenticated Local Wall.
 * Local FS-readable private keys are NOT a Windows ACL security boundary;
 * separate OS identity/keystore is required before production.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const SIGNING_PURPOSE='light-remote:continuity:remote-read-consent:v1';
const MAX_AGE_MS=30000;
const validateId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
function must(ok,code){if(!ok)throw Error(code);}
export function provisionContinuityOwnerAuthority({root,signerDir}){
 must(typeof root==='string'&&path.isAbsolute(root),'continuity_owner_root_invalid');
 must(typeof signerDir==='string'&&path.isAbsolute(signerDir),'continuity_owner_signer_dir_invalid');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 fs.mkdirSync(signerDir,{recursive:true,mode:0o700});
 const publicPath=path.join(root,'owner-authority-public.pem'),privatePath=path.join(signerDir,'continuity-owner-private.pem');
 const publicExists=fs.existsSync(publicPath),privateExists=fs.existsSync(privatePath);
 if(publicExists!==privateExists)throw Error('continuity_owner_authority_inconsistent');
 if(!publicExists){
  const pair=crypto.generateKeyPairSync('ed25519');
  const privatePem=pair.privateKey.export({type:'pkcs8',format:'pem'});
  const publicPem=pair.publicKey.export({type:'spki',format:'pem'});
  fs.writeFileSync(privatePath,privatePem,{mode:0o600,flag:'wx'});
  fs.writeFileSync(publicPath,publicPem,{mode:0o600,flag:'wx'});
 }
 if(process.platform!=='win32'){
  for(const file of [privatePath,publicPath])must((fs.lstatSync(file).mode&0o077)===0,'continuity_owner_authority_unsafe_permissions');
 }
 const privateKey=crypto.createPrivateKey(fs.readFileSync(privatePath));
 const publicKey=crypto.createPublicKey(fs.readFileSync(publicPath));
 must(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'}).equals(publicKey.export({type:'spki',format:'der'})),'continuity_owner_authority_mismatch');
 return {publicPath,privatePath};
}
export function ownerAuthorityPublicKey(root){
 const file=path.join(root,'owner-authority-public.pem');
 if(!fs.existsSync(file))return null;
 if(process.platform!=='win32'&&(fs.lstatSync(file).mode&0o077)!==0)throw Error('continuity_owner_authority_unsafe_permissions');
 return crypto.createPublicKey(fs.readFileSync(file));
}
export function signContinuityConsent({root,signerDir,projectId,enabled,revision,principal,now=Date.now()}){
 must(validateId(projectId),'continuity_project_id_invalid');
 must(typeof enabled==='boolean','continuity_remote_consent_invalid');
 must(Number.isInteger(revision)&&revision>=1,'continuity_stale_revision');
 must(typeof principal==='string'&&principal.length>=1&&principal.length<=254,'continuity_owner_identity_invalid');
 const {privatePath}=provisionContinuityOwnerAuthority({root,signerDir});
 const grant={purpose:SIGNING_PURPOSE,projectId,enabled,revision,
  principal,issuedAt:now,expiresAt:now+MAX_AGE_MS,nonce:crypto.randomBytes(20).toString('hex')};
 const signature=crypto.sign(null,Buffer.from(JSON.stringify(grant)),crypto.createPrivateKey(fs.readFileSync(privatePath))).toString('base64url');
 return {grant,signature};
}
export function verifyContinuityConsent({proof,publicKey,projectId,revision,now=Date.now()}){
 must(publicKey,'continuity_owner_authority_unavailable');
 const g=proof?.grant,sig=proof?.signature;
 must(g&&typeof g==='object'&&!Array.isArray(g)&&typeof sig==='string'&&sig.length<180,'continuity_owner_grant_invalid');
 must(g.purpose===SIGNING_PURPOSE&&g.projectId===projectId&&validateId(g.projectId),'continuity_owner_grant_scope_invalid');
 must(Number.isInteger(revision)&&g.revision===revision,'continuity_stale_revision');
 must(typeof g.enabled==='boolean'&&typeof g.principal==='string'&&g.principal.length>0&&g.principal.length<=254,'continuity_owner_grant_invalid');
 must(typeof g.nonce==='string'&&/^[0-9a-f]{40}$/.test(g.nonce),'continuity_owner_grant_invalid');
 must(Number.isSafeInteger(g.issuedAt)&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt-g.issuedAt===MAX_AGE_MS
   &&g.issuedAt<=now+3000&&g.expiresAt>now,'continuity_owner_grant_expired');
 let signature;
 try{signature=Buffer.from(sig,'base64url');}catch{throw Error('continuity_owner_grant_invalid');}
 must(signature.length===64&&crypto.verify(null,Buffer.from(JSON.stringify(g)),publicKey,signature),'continuity_owner_signature_invalid');
 return g;
}
