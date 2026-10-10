import crypto from 'node:crypto';
import {TeamDispatchAuthorityError} from './team-dispatch-authority.mjs';

// This module is a STATE-ONLY simulator. No FleetRouter, native process,
// device channel, live sessions or UsageRegistry may be passed to it.
// It cannot spawn a command; "running" only means a simulated slot lease.
// Production worker admission MUST be atomic with the device owner scheduler.
const ID=/^[A-Za-z0-9._:-]{1,160}$/;
const CAPS=/^[A-Za-z0-9._:-]{1,80}$/;
const FAMILY_ACTIONS=Object.freeze({
  fs:['read','mkdir','copy','move','delete'],
  search:['start','results'],
  scp:['download','upload'],
  terminal:['start','input','output'],
  desktop:['observe','input'],
  exec:['run'],
  process:['start','input','output']
});
const fail=(message,status=403)=>{throw new TeamDispatchAuthorityError(message,status);};
const sortedUnique=values=>Object.freeze([...new Set(values)].sort());
const canonical=obj=>{
  if(Array.isArray(obj))return obj.map(canonical);
  if(obj&&typeof obj==='object')return Object.fromEntries(
    Object.keys(obj).sort().map(key=>[key,canonical(obj[key])]));
  return obj;
};
const digest=obj=>crypto.createHash('sha256').update(JSON.stringify(canonical(obj))).digest('hex');

/**
 * Computes capabilities from the REAL operation descriptor on the Operator,
 * never from a caller-provided list. Dynamic shell/process command inference
 * must be supplied by the device platform policy (no permissive fallback).
 */
export function teamUatCapabilities(descriptor,{inferCommandCapabilities}={}){
  if(!descriptor||typeof descriptor!=='object'||Array.isArray(descriptor))fail('team_descriptor_invalid',400);
  let encoded;
  try{encoded=JSON.stringify(descriptor);}
  catch{fail('team_descriptor_invalid',400);}
  if(typeof encoded!=='string'||Buffer.byteLength(encoded)>128*1024)
    fail('team_descriptor_too_large',413);
  const {family,action}=descriptor;
  if(!Object.hasOwn(FAMILY_ACTIONS,family)||!FAMILY_ACTIONS[family].includes(action))
    fail('team_descriptor_operation_denied',403);
  // Interactive terminal/process input can embed new executable commands.
  // Do NOT treat only the original shell's capabilities as authorization.
  if((family==='terminal'||family==='process')&&action==='input')
    fail('team_interactive_input_policy_unimplemented',403);
  let required=family==='terminal'?['terminal']
    :family==='desktop'?action==='input'?['desktop','desktop-input']:['desktop']
    :['filesystem'];
  if(family==='exec'||family==='process'&&action==='start'){
    if(typeof descriptor.script!=='string'||!descriptor.script.trim()||descriptor.script.length>100000)
      fail('team_command_descriptor_required',400);
    if(typeof inferCommandCapabilities!=='function')
      fail('team_platform_command_policy_required',503);
    const inferred=inferCommandCapabilities(descriptor.script,{shell:descriptor.shell||null});
    if(!Array.isArray(inferred)||!inferred.length||inferred.some(c=>!CAPS.test(c)))
      fail('team_command_capability_inference_invalid',403);
    required=[...required,...inferred];
  }
  if(descriptor.requiredCapabilities!==undefined||descriptor.accountId!==undefined||
     descriptor.agentId!==undefined||descriptor.ownerAccountId!==undefined||
     descriptor.billedAccountId!==undefined)
    fail('team_descriptor_privileged_fields_forbidden',403);
  return Object.freeze({family,action,requiredCapabilities:sortedUnique(required)});
}
function publicJob(job){
  return Object.freeze({
    jobId:job.jobId,operationId:job.operationId,sessionId:job.sessionId,
    actorAccountId:job.actorAccountId,deviceOwnerAccountId:job.deviceOwnerAccountId,
    billedAccountId:job.billedAccountId,deviceId:job.deviceId,
    family:job.family,action:job.action,state:job.state,
    requiredCapabilities:job.requiredCapabilities,
    admittedAt:job.admittedAt,startedAt:job.startedAt,finishedAt:job.finishedAt,
    previewOnly:true,crossAccountExecutionEnabled:false
  });
}

/**
 * Proof-bound identity is passed by a caller that ALREADY verified Ed25519.
 * Every admission/dispatch/status query calls TeamSessionUatRegistry.get,
 * which revalidates local owner B, owner plan, device and member entitlement.
 */
export class TeamDispatchUatSimulator {
  constructor({teamSessions,inferCommandCapabilities,now=()=>Date.now(),
    maxWorkers=3,maxQueued=32,meterPreview=()=>{},ownerTeamBudgetFor=()=>0}={}){
    if(!teamSessions||typeof teamSessions.get!=='function'||
       typeof now!=='function'||typeof meterPreview!=='function'||typeof ownerTeamBudgetFor!=='function')
      fail('team_simulator_dependencies_required',503);
    if(!Number.isInteger(maxWorkers)||maxWorkers<1||maxWorkers>3||
       !Number.isInteger(maxQueued)||maxQueued<1||maxQueued>256)
      fail('team_simulator_limit_invalid',400);
    this.teamSessions=teamSessions;
    this.inferCommandCapabilities=inferCommandCapabilities;
    this.now=now;
    this.maxWorkers=maxWorkers;this.maxQueued=maxQueued;
    this.meterPreview=meterPreview;this.ownerTeamBudgetFor=ownerTeamBudgetFor;
    this.jobs=new Map();
    this.keys=new Map();
    this.queue=[];
    this.running=new Set();
    this.ownerSlots=new Map();
    this.charges=new Set();
    this.previewLedger=[];
  }

  _identity(identity){
    const actor=String(identity?.authenticatedActorAccountId||'');
    const agent=String(identity?.authenticatedAgentId||'');
    if(!ID.test(actor)||!ID.test(agent))
      fail('team_simulator_verified_oauth_required',403);
    return {authenticatedActorAccountId:actor,authenticatedAgentId:agent};
  }
  _session(sessionId,identity,deviceId,expectedFamily,capabilities){
    const s=this.teamSessions.get(sessionId,identity);
    if(s.accountId!==identity.authenticatedActorAccountId||
       s.actorAccountId!==identity.authenticatedActorAccountId||
       s.deviceId!==deviceId||s.billedAccountId!==s.deviceOwnerAccountId||
       s.crossAccountExecutionEnabled!==false||s.previewOnly!==true||
       s.operation!==expectedFamily||!['active','hold'].includes(s.state)||
       capabilities.some(c=>!s.requiredCapabilities.includes(c)))
      fail('team_simulator_session_policy_denied',403);
    return s;
  }
  _assertOwnership(job,identity){
    if(job.actorAccountId!==identity.authenticatedActorAccountId||
       job.agentId!==identity.authenticatedAgentId)
      fail('team_simulator_job_actor_denied',403);
    return job;
  }
  _revalidate(job,{requireActive=false}={}){
    const identity={authenticatedActorAccountId:job.actorAccountId,
      authenticatedAgentId:job.agentId};
    const plan=teamUatCapabilities(job.descriptor,{
      inferCommandCapabilities:this.inferCommandCapabilities
    });
    if(plan.family!==job.family||plan.action!==job.action||
       digest(plan.requiredCapabilities)!==digest(job.requiredCapabilities))
      fail('team_simulator_capabilities_rotated',403);
    const session=this._session(job.sessionId,identity,job.deviceId,job.family,
      plan.requiredCapabilities);
    if(session.deviceOwnerAccountId!==job.deviceOwnerAccountId||
       session.billedAccountId!==job.billedAccountId)
      fail('team_simulator_owner_identity_changed',403);
    if(requireActive&&session.state!=='active')
      fail('team_simulator_session_on_hold',409);
    return session;
  }
  _release(job,reason){
    job.state='cancelled';job.reason=reason;job.finishedAt=this.now();
    this.running.delete(job.jobId);
    this.queue=this.queue.filter(id=>id!==job.jobId);
  }
  _slots(deviceId){
    let owner=0,team=0;
    for(const row of this.ownerSlots.values())if(row.deviceId===deviceId)owner++;
    for(const id of this.running)if(this.jobs.get(id)?.deviceId===deviceId)team++;
    return {owner,team,total:owner+team};
  }
  slots(deviceId){
    if(!ID.test(deviceId))fail('team_simulator_device_required',400);
    const s=this._slots(deviceId);
    return Object.freeze({deviceId,owner:s.owner,team:s.team,total:s.total,
      free:Math.max(0,this.maxWorkers-s.total),limit:this.maxWorkers,previewOnly:true});
  }
  /**
   * Local simulation of an OWNER worker reservation: the true owner scheduler
   * is NOT connected to this class. Owner reservations cannot be made by
   * member OAuth requests; only the trusted test harness holds this method.
   */
  reserveOwner({deviceId,ownerAccountId,ownerJobId}={}){
    if(!ID.test(deviceId)||!ID.test(ownerAccountId)||!ID.test(ownerJobId))
      fail('team_simulator_owner_slot_invalid',400);
    const prior=this.ownerSlots.get(ownerJobId);
    if(prior){
      if(prior.deviceId!==deviceId||prior.ownerAccountId!==ownerAccountId)
        fail('team_simulator_owner_slot_conflict',409);
      return this.slots(deviceId);
    }
    if(this._slots(deviceId).total>=this.maxWorkers)fail('team_simulator_workers_busy',429);
    this.ownerSlots.set(ownerJobId,{deviceId,ownerAccountId});
    return this.slots(deviceId);
  }
  releaseOwner(ownerJobId){
    if(!this.ownerSlots.has(ownerJobId))fail('team_simulator_owner_slot_not_found',404);
    const {deviceId}=this.ownerSlots.get(ownerJobId);
    this.ownerSlots.delete(ownerJobId);return this.slots(deviceId);
  }

  admit({identity,sessionId,deviceId,operationId,descriptor}={}){
    const actor=this._identity(identity);
    if(!ID.test(sessionId)||!ID.test(deviceId)||!ID.test(operationId))
      fail('team_simulator_ids_invalid',400);
    const plan=teamUatCapabilities(descriptor,{
      inferCommandCapabilities:this.inferCommandCapabilities
    });
    const session=this._session(sessionId,actor,deviceId,plan.family,
      plan.requiredCapabilities);
    const key=[session.deviceOwnerAccountId,actor.authenticatedActorAccountId,
      actor.authenticatedAgentId,deviceId,operationId].join('|');
    const fingerprint=digest({sessionId,deviceId,descriptor});
    const prior=this.keys.get(key);
    if(prior){
      if(prior.fingerprint!==fingerprint)fail('team_simulator_idempotency_conflict',409);
      return publicJob(this.jobs.get(prior.jobId));
    }
    const waiting=this.queue.filter(id=>this.jobs.get(id)?.state==='queued').length;
    if(waiting>=this.maxQueued)fail('team_simulator_queue_full',429);
    const jobId='team-sim-'+crypto.randomUUID();
    const job={jobId,operationId,sessionId,deviceId,
      actorAccountId:actor.authenticatedActorAccountId,agentId:actor.authenticatedAgentId,
      deviceOwnerAccountId:session.deviceOwnerAccountId,billedAccountId:session.billedAccountId,
      family:plan.family,action:plan.action,requiredCapabilities:plan.requiredCapabilities,
      fingerprint,descriptor:structuredClone(descriptor),
      state:'queued',admittedAt:this.now(),startedAt:null,finishedAt:null};
    this.keys.set(key,{jobId,fingerprint});
    this.jobs.set(jobId,job);
    this.queue.push(jobId);
    return publicJob(job);
  }

  /**
   * Simulated dispatch only. Authorization rechecked immediately before a
   * worker slot is occupied, and metering is a PREVIEW event, never a charge.
   */
  dispatchNext(deviceId){
    if(!ID.test(deviceId))fail('team_simulator_device_required',400);
    if(this._slots(deviceId).total>=this.maxWorkers)return null;
    for(const id of [...this.queue]){
      const job=this.jobs.get(id);
      if(job?.state!=='queued')continue;
      if(job.deviceId!==deviceId)continue;
      try{this._revalidate(job,{requireActive:true});}
      catch(error){
        if(error?.message==='team_simulator_session_on_hold')continue;
        this._release(job,'authorization_revoked');continue;
      }
      if(this._slots(deviceId).total>=this.maxWorkers)return null;
      // Team budget is finite even for personal PRO with unlimited personal calls.
      // Preview-only in this process: real dispatch requires durable atomic ledger.
      const budget=Number(this.ownerTeamBudgetFor(job.billedAccountId));
      const month=new Date(this.now()).toISOString().slice(0,7);
      const used=this.previewLedger.filter(e=>e.billedAccountId===job.billedAccountId&&e.month===month).length;
      if(!Number.isSafeInteger(budget)||budget<1||used>=budget){
        this._release(job,'team_monthly_budget_exceeded');continue;
      }
      // Charge counter belongs to the OWNER only. This is never forwarded to
      // UsageRegistry in UAT. Idempotent job key prevents duplicate previews.
      if(!this.charges.has(id)){
        const event=Object.freeze({previewOnly:true,jobId:id,operationId:job.operationId,
          actorAccountId:job.actorAccountId,billedAccountId:job.billedAccountId,
          deviceId:job.deviceId,toolCalls:1,month});
        // If preview recording fails, nothing starts and the queue is intact.
        this.meterPreview(event);
        this.previewLedger.push(event);
        this.charges.add(id);
      }
      job.state='running';job.startedAt=this.now();
      this.running.add(id);
      this.queue=this.queue.filter(x=>x!==id);
      return publicJob(job);
    }
    return null;
  }
  finish(jobId,{cancelled=false}={}){
    const job=this.jobs.get(jobId);
    if(!job||job.state!=='running')fail('team_simulator_job_not_running',409);
    job.state=cancelled?'cancelled':'completed';
    job.finishedAt=this.now();this.running.delete(jobId);
    return publicJob(job);
  }
  job(jobId,identity){
    const actor=this._identity(identity);
    const job=this.jobs.get(jobId);if(!job)fail('team_simulator_job_not_found',404);
    this._assertOwnership(job,actor);
    if(job.state==='queued'||job.state==='running'){
      try{this._revalidate(job);}
      catch(error){this._release(job,'authorization_revoked');}
    }
    return publicJob(job);
  }
  cancel(jobId,identity){
    const actor=this._identity(identity);
    const job=this.jobs.get(jobId);if(!job)fail('team_simulator_job_not_found',404);
    this._assertOwnership(job,actor);
    if(job.state==='running'||job.state==='queued')
      this._release(job,'actor_cancelled');
    return publicJob(job);
  }
  reapRevoked(){
    let count=0;
    for(const job of this.jobs.values()){
      if(job.state!=='queued'&&job.state!=='running')continue;
      try{this._revalidate(job);}
      catch(error){this._release(job,'authorization_revoked');count++;}
    }
    return count;
  }
  ledger(ownerAccountId){
    if(!ID.test(ownerAccountId))fail('team_simulator_owner_required',400);
    return Object.freeze(this.previewLedger.filter(row=>
      row.billedAccountId===ownerAccountId));
  }
}
