/**
 * T04b8-A2: PUBLIC-ONLY recovery signing challenge for Owner CA.
 * Issuer/verifier must NEVER access the Owner CA private key.
 * Proves private-key possession at the time of signing, NOT that an
 * independently held encrypted backup was actually restored.
 * Deliberately NEVER authorizes an operational mTLS release.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const prefix='LIGHT-REMOTE-GOLDABV2-OWNER-CA-RECOVERY-V1';
const schema='light-remote.owner-ca-restore-challenge.v1';
const responseSchema='light-remote.owner-ca-restore-response.v1';
const FAIL=reason=>{throw new Error('gold_owner_ca_restore_challenge_'+reason);};
const hex64=/^[0-9a-f]{64}$/;
const isoString=d=>new Date(d).toISOString();
function safePublicCa(file,pin){
  if(typeof file!=='string'||!path.isAbsolute(file)||!hex64.test(pin))FAIL('invalid_ca_reference');
  let st;
  try{st=fs.lstatSync(file);}catch{FAIL('ca_public_missing');}
  if(!st.isFile()||st.isSymbolicLink()||st.size<300||st.size>32768)
    FAIL('ca_public_invalid_file');
  let c;
  try{c=new crypto.X509Certificate(fs.readFileSync(file));}
  catch{FAIL('ca_public_encoding_invalid');}
  const actual=crypto.createHash('sha256').update(c.raw).digest('hex');
  if(actual!==pin||!c.ca||!c.verify(c.publicKey)||
     c.publicKey.asymmetricKeyType!=='rsa'||
     c.publicKey.asymmetricKeyDetails?.modulusLength!==4096)
    FAIL('ca_public_trust_mismatch');
  return c;
}
function message(challenge){
  return Buffer.from([
    prefix,
    challenge.challengeId,
    challenge.caPublicSha256,
    challenge.issuedAt,
    challenge.expiresAt,
    challenge.nonce,
    challenge.purpose
  ].join('\n')+'\n','utf8');
}
export function ownerCaRecoveryChallengePayload(challenge){
  return message(challenge);
}
function validate(challenge,now){
  if(!challenge||typeof challenge!=='object'||Array.isArray(challenge)||
    challenge.schemaVersion!==schema||
    challenge.purpose!=='offline-recovery-possession-proof-not-release-authorization'||
    !hex64.test(challenge.caPublicSha256??'')||
    !hex64.test(challenge.challengeId??'')||
    !hex64.test(challenge.nonce??'')||
    typeof challenge.issuedAt!=='string'||
    typeof challenge.expiresAt!=='string'||
    !Number.isFinite(now))FAIL('challenge_invalid');
  const issue=Date.parse(challenge.issuedAt),exp=Date.parse(challenge.expiresAt);
  if(!Number.isFinite(issue)||!Number.isFinite(exp)||
    isoString(issue)!==challenge.issuedAt||
    isoString(exp)!==challenge.expiresAt||
    exp-issue>15*60000||exp<=issue||issue>now+300000||exp<=now)
    FAIL('challenge_expired_or_outside_policy');
}
export function issueOwnerCaRecoveryChallenge({
  caFile,expectedCaSha256,now=Date.now(),ttlMinutes=15
}={}){
  safePublicCa(caFile,expectedCaSha256);
  if(!Number.isInteger(ttlMinutes)||ttlMinutes<1||ttlMinutes>15||
    !Number.isFinite(now))FAIL('invalid_ttl');
  const challenge=Object.freeze({
    schemaVersion:schema,
    purpose:'offline-recovery-possession-proof-not-release-authorization',
    caPublicSha256:expectedCaSha256,
    challengeId:crypto.randomBytes(32).toString('hex'),
    nonce:crypto.randomBytes(32).toString('hex'),
    issuedAt:isoString(now),
    expiresAt:isoString(now+ttlMinutes*60000)
  });
  return {challenge,
    releaseApproved:false,releaseStatus:'HOLD',
    privateKeyRead:false,backupVerified:false,trustStoreChanged:false};
}
export function verifyOwnerCaRecoveryResponse({
  caFile,expectedCaSha256,issuedChallenge,response,now=Date.now()
}={}){
  const ca=safePublicCa(caFile,expectedCaSha256);
  validate(issuedChallenge,now);
  if(issuedChallenge.caPublicSha256!==expectedCaSha256)
    FAIL('challenge_ca_mismatch');
  if(!response||typeof response!=='object'||Array.isArray(response)||
    response.schemaVersion!==responseSchema||
    response.challengeId!==issuedChallenge.challengeId||
    typeof response.signatureBase64url!=='string'||
    !/^[A-Za-z0-9_-]{340,850}$/.test(response.signatureBase64url))
    FAIL('response_invalid');
  let sig;
  try{
    sig=Buffer.from(response.signatureBase64url,'base64url');
    if(sig.length!==512||sig.toString('base64url')!==response.signatureBase64url)
      FAIL('signature_not_canonical');
  }catch{FAIL('signature_not_canonical');}
  const ok=crypto.verify('sha256',message(issuedChallenge),
    {key:ca.publicKey,padding:crypto.constants.RSA_PKCS1_PSS_PADDING,saltLength:32},
    sig);
  if(!ok)FAIL('ca_possession_signature_invalid');
  return Object.freeze({
    challengeVerified:true,
    ownerCaPublicSha256:expectedCaSha256,
    recoveredSignerPossessionProved:true,
    independentMediaRecoveryProved:false,
    actualRecoveryDeviceVerified:false,
    releaseApproved:false,
    releaseStatus:'HOLD',
    note:'Signature proves key possession, not independent backup custody or restore',
    signerPrivateKeyRead:false,
    trustStoreChanged:false,
    publicRouterChanged:false
  });
}
function readPublicJson(p){
  if(typeof p!=='string'||!path.isAbsolute(p))FAIL('json_path_invalid');
  let st;
  try{st=fs.lstatSync(p);}catch{FAIL('json_file_missing');}
  if(!st.isFile()||st.isSymbolicLink()||st.size>16384)
    FAIL('json_file_invalid');
  try{return JSON.parse(fs.readFileSync(p,'utf8'));}
  catch{FAIL('json_decode_failed');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2),op=args.shift();
  const allowed=op==='issue'?['--ca-file','--pin']:
    op==='verify'?['--ca-file','--pin','--issued','--response']:[];
  const kv={};let valid=allowed.length>0&&args.length===allowed.length*2;
  for(let i=0;i<args.length;i+=2){
    if(!allowed.includes(args[i])||args[i] in kv||!args[i+1])valid=false;
    else kv[args[i]]=args[i+1];
  }
  try{
    if(!valid||allowed.some(k=>!kv[k]))FAIL('usage');
    const out=op==='issue'?
      issueOwnerCaRecoveryChallenge({caFile:kv['--ca-file'],expectedCaSha256:kv['--pin']}):
      verifyOwnerCaRecoveryResponse({
        caFile:kv['--ca-file'],expectedCaSha256:kv['--pin'],
        issuedChallenge:(()=>{const f=readPublicJson(kv['--issued']);return f.challenge??f;})(),
        response:readPublicJson(kv['--response'])
      });
    process.stdout.write(JSON.stringify(out,null,2)+'\n');
    // No successful result can auto-approve a release.
    process.exitCode=2;
  }catch(e){
    process.stderr.write(String(e?.message?.startsWith('gold_owner_ca_restore_challenge_')?
      e.message:'gold_owner_ca_restore_challenge_blocked')+'\n');
    process.exitCode=3;
  }
}
