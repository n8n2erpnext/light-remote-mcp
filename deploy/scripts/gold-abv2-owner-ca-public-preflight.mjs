/**
 * T04b8-A2: public CA identity preflight for an Owner Windows candidate.
 * Source-only, read-only. IMPORTANT: PUBLIC CA PASS != operational release.
 * Never accepts or reads signing CA private keys, DPAPI blobs or passwords.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const DAY=86400000;
const fail=code=>{throw new Error('gold_owner_ca_public_'+code);};
function openssl(file,args){
  try{
    return execFileSync('openssl',['x509','-in',file,'-noout',...args],
      {encoding:'utf8',stdio:['ignore','pipe','ignore'],
        timeout:10000,maxBuffer:16000});
  }catch{fail('invalid_x509_extensions');}
}
/**
 * Verifies only the public CA PEM and independently supplied SHA256 pin.
 * Deliberately never returns releaseApproved=true. Actual owner disaster
 * recovery, runtime leaf bundle and mTLS live cutover need separate evidence.
 */
export function inspectOwnerGoldCaPublic({
  caFile,expectedCaSha256,expectedSubject='CN=LightRemote-GoldABV2-Owner-CA-CANDIDATE',
  now=Date.now(),minRemainingDays=30
}={}){
  if(typeof caFile!=='string'||!path.isAbsolute(caFile)||
    typeof expectedCaSha256!=='string'||!/^[a-f0-9]{64}$/.test(expectedCaSha256)||
    typeof expectedSubject!=='string'||expectedSubject.length>256||
    !Number.isFinite(now)||!Number.isInteger(minRemainingDays)||
    minRemainingDays<1||minRemainingDays>730)
    fail('arguments_invalid');
  let stat;
  try{stat=fs.lstatSync(caFile);}catch{fail('public_ca_file_missing');}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<300||stat.size>32768)
    fail('invalid_public_ca_file');
  let ca;
  try{ca=new crypto.X509Certificate(fs.readFileSync(caFile));}
  catch{fail('invalid_public_ca_encoding');}
  const actualSha256=crypto.createHash('sha256').update(ca.raw).digest('hex');
  if(actualSha256!==expectedCaSha256)fail('independent_ca_fingerprint_mismatch');
  if(!ca.ca||!ca.verify(ca.publicKey))fail('not_trusted_self_signed_root');
  if(ca.subject.replace(/\s*=\s*/g,'=')!==expectedSubject)
    fail('unexpected_ca_subject');
  if(ca.publicKey.asymmetricKeyType!=='rsa'||
    ca.publicKey.asymmetricKeyDetails?.modulusLength!==4096)
    fail('unexpected_ca_key_type_or_size');
  const bc=openssl(caFile,['-ext','basicConstraints']);
  if(!/Basic Constraints:\s*critical/i.test(bc)||
    !/\bCA:TRUE\b/.test(bc)||!/\bpathlen:0\b/.test(bc))
    fail('invalid_ca_constraints');
  const ku=openssl(caFile,['-ext','keyUsage']);
  if(!/Key Usage:\s*critical/i.test(ku)||!/\bCertificate Sign\b/.test(ku))
    fail('ca_signing_usage_missing');
  const start=Date.parse(ca.validFrom),end=Date.parse(ca.validTo);
  if(!Number.isFinite(start)||!Number.isFinite(end)||
    start>now+300000||end<=now+minRemainingDays*DAY)
    fail('invalid_ca_validity');
  return Object.freeze({
    publicCaVerified:true,
    caDerSha256:actualSha256,
    caSubject:ca.subject,
    caNotAfter:new Date(end).toISOString(),
    publicKey:'RSA-4096',
    caCriticalConstraints:'CA:TRUE,pathlen:0',
    releaseApproved:false,
    releaseStatus:'HOLD',
    pendingReleaseGates:[
      'owner_independent_encrypted_backup_and_recovery_unverified',
      'runtime_server_and_client_leaf_bundles_unverified',
      'guarded_public_lab_mtls_only_cutover_not_accepted',
      'signed_owner_desktop_to_wall_sso_not_accepted'
    ],
    privateKeyRead:false,
    dpapiRead:false,
    trustStoreChanged:false,
    publicRouterChanged:false
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};
  let valid=args.length===4;
  for(let i=0;i<args.length;i+=2){
    if(!['--ca-file','--pin'].includes(args[i])||args[i] in options||
      !args[i+1])valid=false;
    else options[args[i]]=args[i+1];
  }
  try{
    if(!valid||!options['--ca-file']||!options['--pin'])fail('usage');
    const result=inspectOwnerGoldCaPublic({
      caFile:options['--ca-file'],expectedCaSha256:options['--pin']
    });
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    // Exit 2: identity verified, but CA is NOT approved for release.
    process.exitCode=2;
  }catch(e){
    process.stderr.write(String(e?.message?.startsWith('gold_owner_ca_public_')?
      e.message:'gold_owner_ca_public_blocked')+'\n');
    process.exitCode=3;
  }
}
