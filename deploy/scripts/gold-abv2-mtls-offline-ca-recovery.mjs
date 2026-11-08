/**
 * GoldABV2 T04b8-A2: explicit OFFLINE-only encrypted signer-key backup/recovery.
 * No CA creation, remote access, scheduling, logging of private material or deployment.
 * Run on the Owner-controlled OFFLINE signer, never on a live Lab/Plugin/Traefik host.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const fail=(reason)=>{throw new Error('gold_mtls_ca_recovery_'+reason);};
function privateDir(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))fail('absolute_directory_required');
  let st;
  try{st=fs.lstatSync(dir);}catch{fail('directory_missing');}
  if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)
    fail('unsafe_private_directory');
  return path.resolve(dir);
}
function privateFile(dir,name,{key=false}={}){
  const file=path.join(dir,name);
  let st;
  try{st=fs.lstatSync(file);}catch{fail('file_missing');}
  if(!st.isFile()||st.isSymbolicLink()||st.size<20||st.size>131072||
     (key&&(st.mode&0o077)!==0))fail('unsafe_file');
  return file;
}
function passFile(file,source,dest){
  if(typeof file!=='string'||!path.isAbsolute(file))fail('passphrase_file_required');
  const p=path.resolve(file);
  if(p.startsWith(source+path.sep)||p.startsWith(dest+path.sep))
    fail('passphrase_must_be_independent');
  let st;
  try{st=fs.lstatSync(p);}catch{fail('passphrase_file_missing');}
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||
     st.size<24||st.size>8192)fail('unsafe_passphrase_file');
  return p;
}
function checkCa(certPath,keyPath){
  try{
    const ca=new crypto.X509Certificate(fs.readFileSync(certPath));
    if(!ca.ca||!ca.verify(ca.publicKey)||
       !ca.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyPath)))||
       Date.parse(ca.validFrom)>Date.now()||
       Date.parse(ca.validTo)<Date.now()+30*86_400_000)
      fail('invalid_signer_identity');
    return {fingerprint:crypto.createHash('sha256').update(ca.raw).digest('hex'),
      expires:ca.validTo};
  }catch{fail('invalid_signer_identity');}
}
function openssl(args){
  try{execFileSync('openssl',args,{stdio:'ignore',timeout:30000});}
  catch{fail('openssl_failed');}
}
function emptyDest(dir,names){
  for(const n of names)
    if(fs.existsSync(path.join(dir,n)))fail('output_exists');
}
function clean(paths){for(const p of paths){try{fs.rmSync(p,{force:true});}catch{}}}
export function backupOfflineGoldCa({caDir,backupDir,passphraseFile}={}){
  const src=privateDir(caDir),dst=privateDir(backupDir);
  if(src===dst)fail('separate_backup_directory_required');
  const pass=passFile(passphraseFile,src,dst);
  const ca=privateFile(src,'ca.crt'),key=privateFile(src,'ca.key',{key:true});
  const proof=checkCa(ca,key);
  const files=['ca.crt','ca.key.pk8','ca-backup.json'];
  emptyDest(dst,files);
  const created=files.map(x=>path.join(dst,x));
  try{
    fs.copyFileSync(ca,created[0],fs.constants.COPYFILE_EXCL);
    fs.chmodSync(created[0],0o600);
    openssl(['pkcs8','-topk8','-in',key,'-out',created[1],
      '-v2','aes-256-cbc','-v2prf','hmacWithSHA256',
      '-iter','600000','-passout','file:'+pass]);
    fs.chmodSync(created[1],0o600);
    if(!fs.readFileSync(created[1],'utf8').startsWith('-----BEGIN ENCRYPTED PRIVATE KEY-----'))
      fail('encrypted_pkcs8_not_created');
    const manifest={
      version:1,format:'PKCS8-PBES2-AES256-CBC-PBKDF2-SHA256',
      iterations:600000,caSha256:proof.fingerprint,
      caNotAfter:proof.expires,
      encryptedKeySha256:crypto.createHash('sha256')
        .update(fs.readFileSync(created[1])).digest('hex'),
      signingKeyIncludedOnlyEncrypted:true
    };
    fs.writeFileSync(created[2],JSON.stringify(manifest,null,2)+'\n',
      {mode:0o600,flag:'wx'});
    return {ok:true,operation:'offline_ca_encrypted_backup_created',
      caSha256:proof.fingerprint,encryptedKeySha256:manifest.encryptedKeySha256,
      encryption:manifest.format,iterations:600000,
      keyPlaintextInBackup:false,productionDeployed:false};
  }catch(e){clean(created);throw e;}
}
export function restoreOfflineGoldCa({backupDir,restoreDir,passphraseFile,
  expectedCaSha256}={}){
  if(typeof expectedCaSha256!=='string'||
     !/^[a-f0-9]{64}$/.test(expectedCaSha256))
    fail('trusted_ca_fingerprint_required');
  const src=privateDir(backupDir),dst=privateDir(restoreDir);
  if(src===dst)fail('separate_restore_directory_required');
  const pass=passFile(passphraseFile,src,dst);
  const encrypted=privateFile(src,'ca.key.pk8',{key:true});
  const cert=privateFile(src,'ca.crt');
  const manifestFile=privateFile(src,'ca-backup.json');
  let manifest;
  try{manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));}
  catch{fail('invalid_backup_manifest');}
  if(manifest.version!==1||manifest.iterations!==600000||
     manifest.format!=='PKCS8-PBES2-AES256-CBC-PBKDF2-SHA256'||
     !/^[a-f0-9]{64}$/.test(manifest.caSha256)||
     !/^[a-f0-9]{64}$/.test(manifest.encryptedKeySha256))
    fail('invalid_backup_manifest');
  if(manifest.caSha256!==expectedCaSha256)
    fail('trusted_ca_fingerprint_mismatch');
  if(crypto.createHash('sha256').update(fs.readFileSync(encrypted)).digest('hex')!==
     manifest.encryptedKeySha256)fail('encrypted_backup_integrity_mismatch');
  const ca=new crypto.X509Certificate(fs.readFileSync(cert));
  if(crypto.createHash('sha256').update(ca.raw).digest('hex')!==
     manifest.caSha256)fail('ca_certificate_integrity_mismatch');
  const created=['ca.crt','ca.key'].map(x=>path.join(dst,x));
  emptyDest(dst,['ca.crt','ca.key']);
  try{
    fs.copyFileSync(cert,created[0],fs.constants.COPYFILE_EXCL);
    fs.chmodSync(created[0],0o600);
    openssl(['pkcs8','-in',encrypted,'-out',created[1],
      '-passin','file:'+pass]);
    fs.chmodSync(created[1],0o600);
    const proof=checkCa(created[0],created[1]);
    if(proof.fingerprint!==manifest.caSha256)fail('restored_ca_identity_mismatch');
    return {ok:true,operation:'offline_ca_restored_and_matched',
      caSha256:proof.fingerprint,offlineOnly:true,
      signingKeyLogged:false,productionDeployed:false};
  }catch(e){clean(created);throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),cmd=args.shift();
  const allowed=cmd==='backup'?['--ca-dir','--backup-dir','--pass-file']:
    cmd==='restore'?['--backup-dir','--restore-dir','--pass-file',
      '--expected-ca-sha256']:[];
  const kv={};
  let good=allowed.length>0&&args.length%2===0;
  for(let i=0;i<args.length;i+=2){
    if(!allowed.includes(args[i])||args[i] in kv||!args[i+1])good=false;
    else kv[args[i]]=args[i+1];
  }
  try{
    if(!good||allowed.some(x=>!kv[x]))fail('usage');
    const result=cmd==='backup'?
      backupOfflineGoldCa({caDir:kv['--ca-dir'],
        backupDir:kv['--backup-dir'],passphraseFile:kv['--pass-file']}):
      restoreOfflineGoldCa({backupDir:kv['--backup-dir'],
        restoreDir:kv['--restore-dir'],passphraseFile:kv['--pass-file'],
        expectedCaSha256:kv['--expected-ca-sha256']});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(e){
    process.stderr.write(String(e?.message?.startsWith('gold_mtls_ca_recovery_')?
      e.message:'gold_mtls_ca_recovery_blocked')+'\n');
    process.exitCode=3;
  }
}
