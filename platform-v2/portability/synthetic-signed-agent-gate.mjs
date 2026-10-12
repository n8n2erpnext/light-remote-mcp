/**
 * rc50 experimental Ed25519 signed, FAKE-NOOP-only Agent generation gate.
 * This has no imports from actual agents, no filesystem/network/PTY side effects.
 * Keys are supplied by caller; test keypairs must be ephemeral memory-only.
 * NOT owner PKI, real A/B consent, revocation authority or production signing.
 */
import crypto from 'node:crypto';

const ACCOUNT=/^uat_account_[A-Za-z0-9_-]{4,80}$/;
const DEVICE=/^uat_device_[A-Za-z0-9_-]{4,80}$/;
const AGENT=/^uat_agent_[A-Za-z0-9_-]{4,80}$/;
const COMMAND=/^uat_cmd_[A-Za-z0-9_-]{4,80}$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SIG=/^[A-Za-z0-9_-]{86}$/; // Ed25519 64-byte URL-safe base64 without padding
const EPOCH_FIELDS=['kind','accountId','deviceId','agentId','generation','grantRevision','notBefore','expiresAt'];
const COMMAND_FIELDS=['kind','accountId','deviceId','agentId','generation','grantRevision','epochDigest','commandId','notBefore','expiresAt','payload'];
const prefix='LIGHT_REMOTE_RC50_SYNTHETIC_SIGNED_EPOCH_V1:';
const validInt=n=>Number.isSafeInteger(n)&&n>=0;
const keysExactly=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)
  && Object.keys(value).sort().join(',')===fields.slice().sort().join(',');
const encode=(fields,payload)=>JSON.stringify(Object.fromEntries(fields.map(k=>[k,payload[k]])));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const bytes=(type,fields,payload)=>Buffer.from(prefix+type+'\n'+encode(fields,payload),'utf8');
const err=code=>{throw new SyntheticSignedGateError(code);};
export class SyntheticSignedGateError extends Error {
  constructor(code){super(code);this.name='SyntheticSignedGateError';this.code=code;}
}
function validateEpoch(e){
  if(!keysExactly(e,EPOCH_FIELDS)||e.kind!=='fake_epoch'
    ||!ACCOUNT.test(e.accountId||'')||!DEVICE.test(e.deviceId||'')
    ||!AGENT.test(e.agentId||'')||!validInt(e.generation)||e.generation<=0
    ||!validInt(e.grantRevision)||e.grantRevision<=0
    ||!validInt(e.notBefore)||!validInt(e.expiresAt)
    ||e.expiresAt<=e.notBefore||e.expiresAt-e.notBefore>5*60_000)
    err('invalid_fake_signed_epoch');
}
function validateCommand(c){
  if(!keysExactly(c,COMMAND_FIELDS)||c.kind!=='fake_command'
    ||!ACCOUNT.test(c.accountId||'')||!DEVICE.test(c.deviceId||'')
    ||!AGENT.test(c.agentId||'')||!COMMAND.test(c.commandId||'')
    ||!DIGEST.test(c.epochDigest||'')
    ||!validInt(c.generation)||c.generation<=0
    ||!validInt(c.grantRevision)||c.grantRevision<=0
    ||!validInt(c.notBefore)||!validInt(c.expiresAt)
    ||c.expiresAt<=c.notBefore||c.expiresAt-c.notBefore>60_000
    ||!keysExactly(c.payload,['kind','message'])||c.payload.kind!=='fake_noop'
    ||typeof c.payload.message!=='string'||c.payload.message.length>120)
    err('invalid_fake_signed_command');
}
function keyType(k,expected){
  return k?.type===expected && k.asymmetricKeyType==='ed25519';
}
export function syntheticKeyFingerprint(publicKey){
  if(!keyType(publicKey,'public'))err('invalid_fake_verifier');
  return sha(publicKey.export({format:'der',type:'spki'}));
}
/** Helper for TESTS only: never save or export private key in app state. */
export function signSyntheticEpoch(privateKey,epoch){
  if(!keyType(privateKey,'private'))err('invalid_fake_signer');
  validateEpoch(epoch);
  return {payload:epoch,signature:crypto.sign(null,bytes('epoch',EPOCH_FIELDS,epoch),privateKey).toString('base64url')};
}
export function signSyntheticCommand(privateKey,command){
  if(!keyType(privateKey,'private'))err('invalid_fake_signer');
  validateCommand(command);
  return {payload:command,signature:crypto.sign(null,bytes('command',COMMAND_FIELDS,command),privateKey).toString('base64url')};
}
function verifiedEnvelope(packet,key,type,fields,validate){
  if(!keysExactly(packet,['payload','signature'])||typeof packet.signature!=='string'
    ||!SIG.test(packet.signature))err('invalid_signed_envelope');
  validate(packet.payload);
  if(!crypto.verify(null,bytes(type,fields,packet.payload),key,
    Buffer.from(packet.signature,'base64url')))err('signature_not_verified');
  return packet.payload;
}
/**
 * Agent object must be SyntheticAgentGeneration (or an isolated test equivalent).
 * Gate only calls its fake-only receive/startFake API.
 * A process restart must re-present a valid signed epoch before commands.
 */
export class SyntheticSignedAgentGate {
  #agent;#publicKey;#now;#account;#device;#agentId;#current=null;#accepted=new Map();
  constructor({agent,publicKey,accountId,deviceId,agentId,now=()=>Date.now()}={}){
    if(!agent||typeof agent.advanceEpoch!=='function'||typeof agent.receive!=='function'
       ||typeof agent.startFake!=='function'||!keyType(publicKey,'public')
       ||!ACCOUNT.test(accountId||'')||!DEVICE.test(deviceId||'')
       ||!AGENT.test(agentId||'')||typeof now!=='function')
      err('invalid_fake_gate_dependencies');
    this.#agent=agent;this.#publicKey=publicKey;this.#now=now;
    this.#account=accountId;this.#device=deviceId;this.#agentId=agentId;
  }
  #time(payload){
    const now=this.#now();
    if(!validInt(now)||now<payload.notBefore||now>=payload.expiresAt)
      err('signed_envelope_expired_or_not_yet_valid');
  }
  #identity(p){
    if(p.accountId!==this.#account||p.deviceId!==this.#device||p.agentId!==this.#agentId)
      err('signed_envelope_wrong_target');
  }
  get state(){return Object.freeze({mode:'SIGNED_SYNTHETIC_NOOP_ONLY',
    verifiedEpoch:this.#current?.generation??null,realExecutionAllowed:false,
    productionCutoverAuthorized:false});}
  applyEpoch(packet){
    const p=verifiedEnvelope(packet,this.#publicKey,'epoch',EPOCH_FIELDS,validateEpoch);
    this.#identity(p);this.#time(p);
    const epochDigest=sha(bytes('epoch',EPOCH_FIELDS,p));
    // controlProof acts only as an in-memory prototype bridge to older fixture API.
    // Digest prefix never substitutes for signature verification above.
    const controlProof='uat_ctrl_'+epochDigest.slice(0,32);
    const result=this.#agent.advanceEpoch({generation:p.generation,controlProof});
    this.#current={...p,epochDigest};
    this.#accepted.clear();
    return {...result,epochDigest,realExecutionAllowed:false};
  }
  accept(packet){
    const p=verifiedEnvelope(packet,this.#publicKey,'command',COMMAND_FIELDS,validateCommand);
    this.#identity(p);this.#time(p);
    const e=this.#current;
    if(!e)err('signed_epoch_required_after_restart');
    this.#time(e);
    if(p.generation!==e.generation||p.grantRevision!==e.grantRevision
      ||p.epochDigest!==e.epochDigest||p.notBefore<e.notBefore
      ||p.expiresAt>e.expiresAt)
      err('signed_command_epoch_or_grant_mismatch');
    if(this.#agent.generation!==e.generation)err('agent_epoch_state_mismatch');
    const result=this.#agent.receive({agentId:p.agentId,commandId:p.commandId,
      generation:p.generation,payload:p.payload});
    if(result.status==='accepted_receipt_persisted')
      this.#accepted.set(p.commandId,{expiresAt:p.expiresAt,epochDigest:p.epochDigest});
    return result;
  }
  startFake(commandId){
    const e=this.#current;
    if(!e)err('signed_epoch_required_after_restart');
    this.#time(e);
    if(this.#agent.generation!==e.generation)err('agent_epoch_state_mismatch');
    const receipt=this.#accepted.get(commandId);
    if(!receipt||receipt.epochDigest!==e.epochDigest||this.#now()>=receipt.expiresAt)
      err('signed_command_not_fresh_for_start');
    this.#accepted.delete(commandId);
    return this.#agent.startFake(commandId);
  }
}
