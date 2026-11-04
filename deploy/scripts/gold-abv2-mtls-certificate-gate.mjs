/**
 * Offline, read-only T04b8 Lab certificate-release gate.
 * The signing CA private key never belongs in this runtime bundle.
 * Never print certificate/key PEM, credentials or private key paths.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const DAY=86_400_000;
const fail=(code)=>{throw new Error('mtls_certificate_gate_'+code);};
const names=['ca.crt','server.crt','server.key',
  'old.crt','old.key','next.crt','next.key'];

function secureFile(dir,name){
  const p=path.join(dir,name);
  const st=fs.lstatSync(p);
  if(!st.isFile()||st.isSymbolicLink()||st.size<20||st.size>131072)
    fail('invalid_file');
  if(name.endsWith('.key')&&(st.mode&0o077)!==0)
    fail('insecure_private_key_permissions');
  return p;
}
function checkDate(cert,now,minDays,role){
  const notBefore=Date.parse(cert.validFrom);
  const notAfter=Date.parse(cert.validTo);
  if(!Number.isFinite(notBefore)||!Number.isFinite(notAfter)||
      notBefore>now+300000||notAfter<=now||
      notAfter-now<minDays*DAY)fail('invalid_or_expiring_'+role);
  return new Date(notAfter).toISOString();
}
function verifyPurpose(caPath,certPath,purpose,role){
  try{
    execFileSync('openssl',['verify','-CAfile',caPath,
      '-purpose',purpose,certPath],{stdio:'ignore',timeout:10000});
  }catch{fail('invalid_purpose_or_chain_'+role);}
}
function checkKey(cert,file,role){
  try{
    if(!cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(file))))
      fail('mismatched_private_key_'+role);
  }catch{fail('mismatched_private_key_'+role);}
}
export function auditGoldMtlsCertificateBundle({
  dir,serverName='goldabv2.lab',minRemainingDays=30,
  now=Date.now()
}={}){
  if(typeof dir!=='string'||!path.isAbsolute(dir)||
     !/^[a-z0-9.-]{3,253}$/i.test(serverName)||
     !Number.isSafeInteger(minRemainingDays)||minRemainingDays<0||
     minRemainingDays>365||!Number.isFinite(now))fail('invalid_arguments');
  let stat;
  try{stat=fs.lstatSync(dir);}catch{fail('bundle_directory_missing');}
  if(!stat.isDirectory()||stat.isSymbolicLink()||
     (stat.mode&0o077)!==0)fail('insecure_bundle_directory');
  if(fs.existsSync(path.join(dir,'ca.key')))
    fail('signing_ca_private_key_in_runtime_bundle');
  const paths={};
  try{for(const name of names)paths[name]=secureFile(dir,name);}
  catch(err){
    if(err?.message?.startsWith('mtls_certificate_gate_'))throw err;
    fail('bundle_file_missing');
  }
  let ca,server,old,next;
  try{
    ca=new crypto.X509Certificate(fs.readFileSync(paths['ca.crt']));
    server=new crypto.X509Certificate(fs.readFileSync(paths['server.crt']));
    old=new crypto.X509Certificate(fs.readFileSync(paths['old.crt']));
    next=new crypto.X509Certificate(fs.readFileSync(paths['next.crt']));
  }catch{fail('invalid_x509_encoding');}
  if(!ca.ca||!ca.verify(ca.publicKey))fail('invalid_ca');
  const expiry={
    ca:checkDate(ca,now,minRemainingDays,'ca'),
    server:checkDate(server,now,minRemainingDays,'server'),
    old:checkDate(old,now,minRemainingDays,'old'),
    next:checkDate(next,now,minRemainingDays,'next')
  };
  if(!server.checkIssued(ca)||!server.verify(ca.publicKey)||
     !old.checkIssued(ca)||!old.verify(ca.publicKey)||
     !next.checkIssued(ca)||!next.verify(ca.publicKey))
    fail('wrong_ca_or_signature');
  if(!server.checkHost(serverName))fail('server_identity_mismatch');
  verifyPurpose(paths['ca.crt'],paths['server.crt'],'sslserver','server');
  verifyPurpose(paths['ca.crt'],paths['old.crt'],'sslclient','old');
  verifyPurpose(paths['ca.crt'],paths['next.crt'],'sslclient','next');
  checkKey(server,paths['server.key'],'server');
  checkKey(old,paths['old.key'],'old');
  checkKey(next,paths['next.key'],'next');
  const oldPin=crypto.createHash('sha256').update(old.raw).digest('hex');
  const nextPin=crypto.createHash('sha256').update(next.raw).digest('hex');
  if(oldPin===nextPin)fail('duplicate_rotation_identity');
  if(new Date(expiry.old)>new Date(expiry.ca)||
     new Date(expiry.next)>new Date(expiry.ca)||
     new Date(expiry.server)>new Date(expiry.ca))
    fail('leaf_expires_after_ca');
  return Object.freeze({
    ok:true,mode:'offline_read_only',
    clientIdentityPolicy:'exact_old_and_next_sha256_pins',
    oldClientSha256:oldPin,nextClientSha256:nextPin,
    serverName,minimumDays:minRemainingDays,expires:expiry,
    caPrivateKeyRead:false,configurationChanged:false
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);
  const value=(flag,def)=>{const i=args.indexOf(flag);return i<0?def:args[i+1];};
  try{
    if(args.includes('--help')||args.some(x=>x.startsWith('--')&&
       !['--dir','--name','--min-days'].includes(x)))
      fail('usage');
    const result=auditGoldMtlsCertificateBundle({
      dir:value('--dir'),serverName:value('--name','goldabv2.lab'),
      minRemainingDays:Number(value('--min-days','30'))
    });
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(err){
    process.stderr.write(String(err?.message?.startsWith('mtls_certificate_gate_')?
      err.message:'mtls_certificate_gate_blocked')+'\n');
    process.exitCode=3;
  }
}
