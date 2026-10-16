/**
 * rc.50 DEV/UAT ONLY: signed observation of ONE known native Agent effect.
 *
 * This does NOT prove global quiescence, authorize journal settlement, or
 * establish a writer epoch. A signer can lose its in-memory registry after
 * restart; a missing handle MUST never be interpreted as 'exited'.
 */
import crypto from 'node:crypto';

const VERSION=1;
const DOMAIN='LR-RC50-DEV-AGENT-LIFETIME-OBSERVATION-V1\x00';
const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const TOKEN=/^[A-Za-z0-9_-]{32,128}$/;
const FIELDS=['version','accountId','deviceId','nodeId','commandId',
  'writerGeneration','bootId','challenge','kind','handleId','startedAt',
  'finishedAt','observation','issuedAt','expiresAt'];
const OWNER_FIELDS=['accountId','deviceId','nodeId','commandId'];
const isTime=v=>Number.isSafeInteger(v)&&v>0;
const validId=(v,label)=>{if(typeof v!=='string'||!ID.test(v))throw Error('DEV_LIFETIME_INVALID_'+label);return v;};
const validToken=(v,label)=>{if(typeof v!=='string'||!TOKEN.test(v))throw Error('DEV_LIFETIME_INVALID_'+label);return v;};
function normalizeBody(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    Object.keys(value).sort().join(',')!==[...FIELDS].sort().join(','))
    throw Error('DEV_LIFETIME_INVALID_SCHEMA');
  const x={};
  for(const key of FIELDS)x[key]=value[key];
  if(x.version!==VERSION)throw Error('DEV_LIFETIME_VERSION_INVALID');
  for(const key of OWNER_FIELDS)validId(x[key],key);
  validToken(x.bootId,'bootId');validToken(x.challenge,'challenge');
  if(!Number.isSafeInteger(x.writerGeneration)||x.writerGeneration<1)
    throw Error('DEV_LIFETIME_GENERATION_INVALID');
  if(!['process','terminal'].includes(x.kind))throw Error('DEV_LIFETIME_KIND_INVALID');
  if((x.kind==='process'&&!/^lp_[A-Za-z0-9_-]{20,80}$/.test(x.handleId))||
     (x.kind==='terminal'&&!/^ltm_[A-Za-z0-9_-]{20,80}$/.test(x.handleId)))
    throw Error('DEV_LIFETIME_HANDLE_INVALID');
  if(!isTime(x.startedAt)||!isTime(x.issuedAt)||!isTime(x.expiresAt)||
    x.expiresAt<x.issuedAt||x.expiresAt-x.issuedAt>30000)
    throw Error('DEV_LIFETIME_TIME_INVALID');
  if(x.observation==='active'){
    if(x.finishedAt!==null)throw Error('DEV_LIFETIME_ACTIVE_MISMATCH');
  }else if(x.observation==='exited'){
    if(!isTime(x.finishedAt)||x.finishedAt<x.startedAt)
      throw Error('DEV_LIFETIME_EXIT_MISMATCH');
  }else throw Error('DEV_LIFETIME_OBSERVATION_INVALID');
  if(x.startedAt>x.issuedAt||x.finishedAt!==null&&x.finishedAt>x.issuedAt)
    throw Error('DEV_LIFETIME_CAUSALITY_INVALID');
  return x;
}
function message(body){
  return Buffer.concat([Buffer.from(DOMAIN,'utf8'),
    Buffer.from(JSON.stringify(normalizeBody(body)),'utf8')]);
}
function observedHandle({registry,kind,handleId,accountId,deviceId,sessionId,agentId}){
  if(!registry||typeof registry.list!=='function')throw Error('DEV_LIFETIME_REGISTRY_REQUIRED');
  const owner={accountId,deviceId,sessionId,agentId};
  for(const [key,value] of Object.entries(owner))validId(value,key);
  const entries=registry.list(owner);
  if(!Array.isArray(entries))throw Error('DEV_LIFETIME_CENSUS_UNAVAILABLE');
  const key=kind==='process'?'processId':'terminalId';
  const matches=entries.filter(v=>v?.[key]===handleId);
  // RAM inventory loss, pruning, unavailable registry or wrong owner is NOT exit proof.
  if(matches.length!==1)throw Error('DEV_LIFETIME_HANDLE_UNOBSERVED');
  const row=matches[0];
  for(const [field,value] of Object.entries(owner)){
    if(row[field]!==value)throw Error('DEV_LIFETIME_OWNER_MISMATCH');
  }
  if(!isTime(row.startedAt)||row.finishedAt!==null&&
     (!isTime(row.finishedAt)||row.finishedAt<row.startedAt))
    throw Error('DEV_LIFETIME_ROW_INVALID');
  return row;
}
export function signDevAgentLifetimeObservation({
  registry,kind,handleId,owner,commandId,nodeId,writerGeneration,
  bootId,challenge,privateKey,now=Date.now()
}={}){
  const accountId=owner?.accountId,deviceId=owner?.deviceId;
  const row=observedHandle({registry,kind,handleId,...owner});
  if(!isTime(now))throw Error('DEV_LIFETIME_TIME_INVALID');
  const body=normalizeBody({
    version:VERSION,accountId,deviceId,nodeId,commandId,
    writerGeneration,bootId,challenge,kind,handleId,
    startedAt:row.startedAt,finishedAt:row.finishedAt,
    observation:row.finishedAt===null?'active':'exited',
    issuedAt:now,expiresAt:now+15000
  });
  if(!privateKey)throw Error('DEV_LIFETIME_SIGNING_KEY_REQUIRED');
  const signer=privateKey?.type==='private'?privateKey:crypto.createPrivateKey(privateKey);
  if(signer.asymmetricKeyType!=='ed25519')throw Error('DEV_LIFETIME_SIGNER_NOT_ED25519');
  const signature=crypto.sign(null,message(body),signer).toString('base64url');
  return {body,signature};
}
export function verifyDevAgentLifetimeObservation({
  receipt,publicKey,expected,now=Date.now(),seenChallenges
}={}){
  if(!receipt||typeof receipt!=='object'||Array.isArray(receipt)||
     Object.keys(receipt).sort().join(',')!=='body,signature')
    throw Error('DEV_LIFETIME_RECEIPT_INVALID');
  const body=normalizeBody(receipt.body);
  if(typeof receipt.signature!=='string'||
     !/^[A-Za-z0-9_-]{80,100}$/.test(receipt.signature))
    throw Error('DEV_LIFETIME_SIGNATURE_INVALID');
  if(!publicKey||!expected||typeof expected!=='object'||
     !seenChallenges||typeof seenChallenges.has!=='function'||
     typeof seenChallenges.add!=='function')
    throw Error('DEV_LIFETIME_TRUST_CONTEXT_REQUIRED');
  for(const key of ['accountId','deviceId','nodeId','commandId',
    'writerGeneration','bootId','challenge','kind','handleId']){
    if(!Object.hasOwn(expected,key)||body[key]!==expected[key])
      throw Error('DEV_LIFETIME_BINDING_MISMATCH:'+key);
  }
  if(!isTime(now)||now<body.issuedAt-2000||now>body.expiresAt)
    throw Error('DEV_LIFETIME_EXPIRED');
  if(seenChallenges.has(body.challenge))throw Error('DEV_LIFETIME_REPLAY');
  let ok=false;
  try{
    const verifier=publicKey?.type==='public'?publicKey:crypto.createPublicKey(publicKey);
    if(verifier.asymmetricKeyType!=='ed25519')throw Error('DEV_LIFETIME_VERIFIER_NOT_ED25519');
    const sig=Buffer.from(receipt.signature,'base64url');
    ok=sig.length===64&&crypto.verify(null,message(body),verifier,sig);
  }catch{}
  if(!ok)throw Error('DEV_LIFETIME_SIGNATURE_INVALID');
  seenChallenges.add(body.challenge);
  // The verifier has NO journal settlement function or side effects.
  return {observation:body.observation,
    verdict:body.observation==='active'?'BLOCK_ACTIVE':'EXIT_OBSERVED_UNFENCED',
    settlementAuthorized:false,commandId:body.commandId,handleId:body.handleId,
    writerGeneration:body.writerGeneration,observedAt:body.issuedAt};
}
