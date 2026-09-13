import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function sha256(value){return crypto.createHash('sha256').update(value).digest('hex');}

export function loadOrCreateHostDeviceIdentity(file){
  const target=String(file||'').trim();
  if(!target)throw new Error('host_device_identity_file_required');
  const dir=path.dirname(target);fs.mkdirSync(dir,{recursive:true,mode:0o750});
  if(fs.existsSync(target)){
    const row=JSON.parse(fs.readFileSync(target,'utf8'));
    const privateKey=crypto.createPrivateKey({key:Buffer.from(row.privateKey,'base64'),format:'der',type:'pkcs8'});
    const publicKey=crypto.createPublicKey({key:Buffer.from(row.publicKey,'base64'),format:'der',type:'spki'});
    if(privateKey.asymmetricKeyType!=='ed25519'||publicKey.asymmetricKeyType!=='ed25519')throw new Error('invalid_host_device_identity_type');
    const canonical=publicKey.export({format:'der',type:'spki'}).toString('base64'),derived=crypto.createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64');
    if(canonical!==row.publicKey||derived!==canonical)throw new Error('host_device_identity_public_key_mismatch');
    fs.chmodSync(target,0o600);
    return {...row,publicKeySha256:sha256(Buffer.from(canonical,'base64'))};
  }
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ed25519');
  const row={
    schemaVersion:1,
    algorithm:'Ed25519',
    privateKey:privateKey.export({format:'der',type:'pkcs8'}).toString('base64'),
    publicKey:publicKey.export({format:'der',type:'spki'}).toString('base64'),
    createdAt:Date.now()
  };
  const tmp=`${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify(row,null,2)}\n`,{mode:0o600});
  fs.chmodSync(tmp,0o600);fs.renameSync(tmp,target);fs.chmodSync(target,0o600);
  return {...row,publicKeySha256:sha256(Buffer.from(row.publicKey,'base64'))};
}


export function ensureHostCompanionState(file,{identity,binding,signer,nodeId}){
  const target=String(file||'').trim();if(!target)throw new Error('host_companion_state_file_required');
  let prior={};try{prior=JSON.parse(fs.readFileSync(target,'utf8'));}catch{}
  if(prior.enrollment?.deviceId&&prior.enrollment.deviceId!==binding.deviceId)throw new Error('host_companion_device_conflict');
  if(prior.identity?.publicIdentityKey&&prior.identity.publicIdentityKey!==identity.publicKey)throw new Error('host_companion_identity_conflict');
  const denied=Array.isArray(prior.policy?.deniedCapabilities)?prior.policy.deniedCapabilities:[];
  const approved=[...(binding.approvedCapabilities||[])],effective=approved.filter(cap=>!denied.includes(cap)).sort();
  const state={...prior,
    identity:{algorithm:'Ed25519',publicIdentityKey:identity.publicKey,publicKeySha256:identity.publicKeySha256,createdAt:identity.createdAt},
    enrollment:{...(prior.enrollment||{}),enrollmentId:'trusted-host',deviceId:binding.deviceId,nodeId:String(nodeId||binding.deviceId),accountId:binding.accountId,grantableCapabilities:[...(binding.grantableCapabilities||approved)],approvedCapabilities:approved,policyProfile:binding.policyProfile,displayName:binding.displayName||binding.deviceId,certificate:binding.certificate,certificateSignature:binding.certificateSignature,signer,enrolledAt:prior.enrollment?.enrolledAt||Date.now()},
    policy:{...(prior.policy||{}),serverPolicyRevision:Math.max(1,Number(binding.policyRevision)||1),localFinalDenyBoundary:true},
    effectiveCapabilities:effective,
    cloud:prior.cloud||{desiredConnected:false,state:'dormant',connectionId:null,hardExpiresAt:null,lastError:null,lastDisconnectedAt:Date.now()}
  };
  const dir=path.dirname(target);fs.mkdirSync(dir,{recursive:true,mode:0o750});const tmp=`${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,`${JSON.stringify(state,null,2)}\n`,{mode:0o600});fs.chmodSync(tmp,0o600);fs.renameSync(tmp,target);fs.chmodSync(target,0o600);return state;
}
