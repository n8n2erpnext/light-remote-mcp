/*
 * Experimental Project Continuity owner-stepup signer.
 * The Ed25519 private key is NEVER written as plaintext PEM. A password
 * unlocks its encrypted local envelope only after Wall re-authentication.
 *
 * LIMIT: this does not make a same-user SQLite DB tamperproof nor prevent a
 * compromised owner process from intercepting the entered password. OS user /
 * service separation, Windows ACL and protected keystore are release gates.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PURPOSE='light-remote:continuity:remote-read-consent:v1';
const AAD=Buffer.from('light-remote-continuity-owner-key-v1','utf8');
const VALID_FOR_MS=30000;
const PRIVATE_FILENAME='continuity-owner-private.enc.json';
function ensure(v,error){if(!v)throw Error(error);}
function safePath(file){
 if(!fs.existsSync(file))return false;
 const st=fs.lstatSync(file);
 ensure(st.isFile()&&!st.isSymbolicLink(),'continuity_owner_authority_unsafe_file');
 if(process.platform!=='win32')
  ensure((st.mode&0o077)===0,'continuity_owner_authority_unsafe_permissions');
 return true;
}
function keyPaths(root,signerDir){
 ensure(typeof root==='string'&&path.isAbsolute(root),'continuity_owner_root_invalid');
 ensure(typeof signerDir==='string'&&path.isAbsolute(signerDir),'continuity_owner_signer_dir_invalid');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 fs.mkdirSync(signerDir,{recursive:true,mode:0o700});
 for(const dir of [root,signerDir]){
  const st=fs.lstatSync(dir);
  ensure(st.isDirectory()&&!st.isSymbolicLink(),'continuity_owner_authority_unsafe_dir');
  // For the signer dir, others must not be able to discover/replace key files.
  if(dir===signerDir&&process.platform!=='win32')
   ensure((st.mode&0o077)===0,'continuity_owner_signer_dir_not_private');
 }
 return {publicPath:path.join(root,'owner-authority-public.pem'),
  privatePath:path.join(signerDir,PRIVATE_FILENAME)};
}
function deriveKey(password,salt){
 ensure(typeof password==='string'&&password.length>0&&password.length<=1024,'continuity_owner_password_required');
 return crypto.scryptSync(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
}
function lockPrivateKey(key,password){
 const salt=crypto.randomBytes(16),iv=crypto.randomBytes(12);
 const derived=deriveKey(password,salt);
 const encryptor=crypto.createCipheriv('aes-256-gcm',derived,iv);
 encryptor.setAAD(AAD);
 const pem=key.export({type:'pkcs8',format:'pem'});
 const ciphertext=Buffer.concat([encryptor.update(pem,'utf8'),encryptor.final()]);
 derived.fill(0);
 return {schema:1,kdf:'scrypt-N32768-r8-p1',cipher:'aes-256-gcm',salt:salt.toString('base64url'),
  iv:iv.toString('base64url'),tag:encryptor.getAuthTag().toString('base64url'),
  data:ciphertext.toString('base64url')};
}
function unlockPrivateKey(encoded,password){
 try{
  const env=JSON.parse(encoded);
  ensure(env.schema===1&&env.kdf==='scrypt-N32768-r8-p1'&&env.cipher==='aes-256-gcm','continuity_owner_envelope_invalid');
  const salt=Buffer.from(env.salt,'base64url'),iv=Buffer.from(env.iv,'base64url');
  const tag=Buffer.from(env.tag,'base64url'),data=Buffer.from(env.data,'base64url');
  ensure(salt.length===16&&iv.length===12&&tag.length===16&&data.length>32&&data.length<10000,'continuity_owner_envelope_invalid');
  const derived=deriveKey(password,salt);
  try{
   const decipher=crypto.createDecipheriv('aes-256-gcm',derived,iv);decipher.setAAD(AAD);decipher.setAuthTag(tag);
   const pem=Buffer.concat([decipher.update(data),decipher.final()]);
   try{return crypto.createPrivateKey(pem);}finally{pem.fill(0);}
  }finally{derived.fill(0);}
 }catch{throw Error('continuity_owner_signer_unlock_failed');}
}
export function provisionContinuityOwnerAuthority({root,signerDir,password=null}){
 const {publicPath,privatePath}=keyPaths(root,signerDir);
 const publicExists=safePath(publicPath),privateExists=safePath(privatePath);
 ensure(publicExists===privateExists,'continuity_owner_authority_inconsistent');
 if(!publicExists){
  // Normal Agent startup does not know the owner credential. Never provision
  // an unencrypted key or use the Wall cookie secret to silently unlock it.
  if(password===null)return {publicPath,privatePath,initialized:false};
  const pair=crypto.generateKeyPairSync('ed25519');
  const envelope=lockPrivateKey(pair.privateKey,password);
  fs.writeFileSync(privatePath,JSON.stringify(envelope)+'\n',{mode:0o600,flag:'wx'});
  fs.writeFileSync(publicPath,pair.publicKey.export({type:'spki',format:'pem'}),{mode:0o600,flag:'wx'});
 }
 if(password!==null){
  const privateKey=unlockPrivateKey(fs.readFileSync(privatePath,'utf8'),password);
  const publicKey=crypto.createPublicKey(fs.readFileSync(publicPath));
  ensure(crypto.createPublicKey(privateKey).export({type:'spki',format:'der'})
   .equals(publicKey.export({type:'spki',format:'der'})),'continuity_owner_authority_mismatch');
 }
 return {publicPath,privatePath,initialized:true};
}
export function ownerAuthorityPublicKey(root){
 const file=path.join(root,'owner-authority-public.pem');
 if(!safePath(file))return null;
 return crypto.createPublicKey(fs.readFileSync(file));
}
export function signContinuityConsent({root,signerDir,password,projectId,enabled,revision,principal,now=Date.now()}){
 ensure(typeof projectId==='string'&&/^[a-f0-9-]{36}$/.test(projectId),'continuity_project_id_invalid');
 ensure(typeof enabled==='boolean','continuity_remote_consent_invalid');
 ensure(Number.isInteger(revision)&&revision>=1,'continuity_stale_revision');
 ensure(typeof principal==='string'&&principal.length>=1&&principal.length<=254,'continuity_owner_identity_invalid');
 const {privatePath}=provisionContinuityOwnerAuthority({root,signerDir,password});
 const privateKey=unlockPrivateKey(fs.readFileSync(privatePath,'utf8'),password);
 const grant={purpose:PURPOSE,projectId,enabled,revision,principal,issuedAt:now,
  expiresAt:now+VALID_FOR_MS,nonce:crypto.randomBytes(20).toString('hex')};
 const signature=crypto.sign(null,Buffer.from(JSON.stringify(grant)),privateKey).toString('base64url');
 return {grant,signature};
}
export function verifyContinuityConsent({proof,publicKey,projectId,revision,now=Date.now()}){
 ensure(publicKey,'continuity_owner_authority_unavailable');
 const g=proof?.grant,sig=proof?.signature;
 ensure(g&&typeof g==='object'&&!Array.isArray(g)&&typeof sig==='string'&&sig.length<180,'continuity_owner_grant_invalid');
 ensure(g.purpose===PURPOSE&&g.projectId===projectId&&typeof g.projectId==='string','continuity_owner_grant_scope_invalid');
 ensure(Number.isInteger(revision)&&g.revision===revision,'continuity_stale_revision');
 ensure(typeof g.enabled==='boolean'&&typeof g.principal==='string'&&g.principal.length>0&&g.principal.length<=254,'continuity_owner_grant_invalid');
 ensure(typeof g.nonce==='string'&&/^[0-9a-f]{40}$/.test(g.nonce),'continuity_owner_grant_invalid');
 ensure(Number.isSafeInteger(g.issuedAt)&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt-g.issuedAt===VALID_FOR_MS
  &&g.issuedAt<=now+3000&&g.expiresAt>now,'continuity_owner_grant_expired');
 let signature;
 try{signature=Buffer.from(sig,'base64url');}catch{throw Error('continuity_owner_grant_invalid');}
 ensure(signature.length===64&&crypto.verify(null,Buffer.from(JSON.stringify(g)),publicKey,signature),'continuity_owner_signature_invalid');
 return g;
}
