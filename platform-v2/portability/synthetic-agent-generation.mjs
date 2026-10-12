/**
 * rc50 P0: isolated, synthetic-only device-side generation/receipt prototype.
 * NO real command execution, no network, no PTY, no production Agent imports.
 * Unauthenticated test-only controlProof is NOT a signed owner authorization.
 * A local snapshot cannot prove a global writer lease or remote side effects.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {writeSyntheticJsonDurably} from './durable-json-synthetic.mjs';

export class SyntheticAgentError extends Error {
  constructor(code,cause){super(code,{cause});this.name='SyntheticAgentError';this.code=code;}
}
const reject=(code,cause)=>{throw new SyntheticAgentError(code,cause);};
const ID=/^uat_agent_[a-zA-Z0-9_-]{4,80}$/;
const CMD=/^uat_cmd_[a-zA-Z0-9_-]{4,80}$/;
const CONTROL=/^uat_ctrl_[a-zA-Z0-9_-]{8,80}$/;
const HEX=/^[a-f0-9]{64}$/;
const MAX_COMMANDS=512;
function validGen(n){return Number.isSafeInteger(n)&&n>0&&n<Number.MAX_SAFE_INTEGER;}
function clone(v){return JSON.parse(JSON.stringify(v));}
function envelopeDigest({commandId,generation,agentId,payload}){
  return crypto.createHash('sha256')
    .update(JSON.stringify({commandId,generation,agentId,payload})).digest('hex');
}
function validateDirectory(root){
  if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root
    ||path.dirname(root)!==path.resolve(os.tmpdir())
    ||!path.basename(root).startsWith('lr-rc50-agent-fixture-'))
    reject('not_synthetic_agent_fixture_root');
  const st=fs.lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink())reject('invalid_agent_fixture_directory');
}
function checkState(data,agentId){
  if(!data||data.schemaVersion!==1||data.agentId!==agentId
    ||!Number.isSafeInteger(data.generation)||data.generation<0
    ||!data.commands||typeof data.commands!=='object'||Array.isArray(data.commands)
    ||Object.keys(data.commands).length>MAX_COMMANDS)
    reject('invalid_synthetic_agent_state');
  if(data.generation===0 ? data.controlProof!==null : !CONTROL.test(data.controlProof||''))
    reject('invalid_agent_control_state');
  for(const [key,row] of Object.entries(data.commands)){
    if(!CMD.test(key)||!row||row.commandId!==key||!validGen(row.generation)
      ||row.generation>data.generation||!HEX.test(row.digest||'')
      ||!['accepted','started','completed','fenced','uncertain'].includes(row.status))
      reject('invalid_agent_receipt_state');
  }
}
export class SyntheticAgentGeneration {
  #root;#file;#state;#poisoned=false;#writer;
  constructor({root,agentId,writer=null}={}){
    validateDirectory(root);
    if(!ID.test(agentId||''))reject('invalid_synthetic_agent_id');
    this.#root=root;
    this.#file=path.join(root,'receipts.json');
    this.#writer=writer||((file,value)=>writeSyntheticJsonDurably({root,file,value}));
    if(typeof this.#writer!=='function')reject('invalid_synthetic_writer');
    const exists=fs.existsSync(this.#file);
    if(exists){
      const st=fs.lstatSync(this.#file);
      if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0)
        reject('unsafe_synthetic_receipt_file');
    }
    try{
      this.#state=exists?JSON.parse(fs.readFileSync(this.#file,'utf8')):{
        schemaVersion:1,agentId,generation:0,controlProof:null,commands:{}
      };
    }catch(error){reject('synthetic_agent_load_failed',error);}
    checkState(this.#state,agentId);
    // Do not automatically execute or retry a command after process restart:
    // an in-flight side effect may have already occurred before a crash.
    let changed=false;
    for(const row of Object.values(this.#state.commands)){
      if(row.status==='started'||row.status==='accepted'){
        row.status='uncertain';changed=true;
      }
    }
    if(changed)this.#persist();
  }
  #check(){if(this.#poisoned)reject('synthetic_agent_poisoned_restart_and_reconcile');}
  #persist(){
    this.#check();
    try{this.#writer(this.#file,clone(this.#state));}
    catch(error){this.#poisoned=true;reject('synthetic_agent_persist_failed',error);}
  }
  get generation(){this.#check();return this.#state.generation;}
  get status(){return Object.freeze({mode:'SYNTHETIC_ONLY_NOT_AUTHORITY',poisoned:this.#poisoned,
    generation:this.#state.generation,receiptCount:Object.keys(this.#state.commands).length,
    realCommandExecutionAllowed:false,productionCutoverAuthorized:false});}
  receipts(){this.#check();return clone(this.#state.commands);}
  advanceEpoch({generation,controlProof}={}){
    this.#check();
    if(!validGen(generation)||typeof controlProof!=='string'||!CONTROL.test(controlProof))
      reject('invalid_synthetic_epoch_control');
    if(generation<this.#state.generation)reject('stale_epoch_control');
    if(generation===this.#state.generation){
      if(controlProof!==this.#state.controlProof)reject('conflicting_epoch_control');
      return Object.freeze({status:'already_current',generation});
    }
    for(const row of Object.values(this.#state.commands)){
      if(row.status==='accepted')row.status='fenced';
      if(row.status==='started')row.status='uncertain';
    }
    this.#state.generation=generation;this.#state.controlProof=controlProof;
    this.#persist();
    return Object.freeze({status:'synthetic_epoch_advanced',generation,
      productionCutoverAuthorized:false});
  }
  receive({agentId,commandId,generation,payload}={}){
    this.#check();
    if(agentId!==this.#state.agentId||!CMD.test(commandId||'')
      ||!validGen(generation)||!payload||Object.keys(payload).sort().join(',')!=='kind,message'
      ||payload.kind!=='fake_noop'||typeof payload.message!=='string'
      ||payload.message.length>120)
      reject('invalid_fake_command_envelope');
    const digest=envelopeDigest({agentId,commandId,generation,payload});
    const known=this.#state.commands[commandId];
    if(known){
      if(known.digest!==digest||known.generation!==generation)
        reject('command_id_conflicting_envelope');
      return Object.freeze({status:'duplicate_no_execution',receiptStatus:known.status,
        commandId,willExecute:false});
    }
    if(generation!==this.#state.generation)reject('stale_or_unapproved_agent_generation');
    if(Object.keys(this.#state.commands).length>=MAX_COMMANDS)reject('agent_receipt_cap_reached');
    this.#state.commands[commandId]={commandId,generation,digest,status:'accepted',
      resultDigest:null};
    this.#persist();
    return Object.freeze({status:'accepted_receipt_persisted',commandId,
      willExecute:false,realCommandExecutionAllowed:false});
  }
  startFake(commandId){
    this.#check();
    const row=this.#state.commands[commandId];
    if(!row||row.status!=='accepted'||row.generation!==this.#state.generation)
      reject('command_not_safe_to_start');
    row.status='started';
    this.#persist();
    // Intentional: does not accept an executor callback or OS command.
    return Object.freeze({status:'fake_start_receipt_persisted',commandId,executed:false});
  }
  completeFake(commandId){
    this.#check();
    const row=this.#state.commands[commandId];
    if(!row||row.status!=='started'||row.generation!==this.#state.generation)
      reject('command_not_safe_to_complete');
    row.status='completed';
    row.resultDigest=crypto.createHash('sha256').update('synthetic_noop_completed:'+commandId).digest('hex');
    this.#persist();
    return Object.freeze({status:'fake_completion_receipt_persisted',commandId,
      resultDigest:row.resultDigest,executed:false});
  }
}
