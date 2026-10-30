#!/usr/bin/env node
/**
 * P2-B UAT cutover orchestrator, READ-ONLY gate v1.
 *
 * This build DOES NOT implement --apply: that phase requires a separately
 * reviewed four-unit/schema042 transactional runner and owner authorization.
 * Running preflight on live Gold UAT NEVER changes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import http from 'node:http';
import {GOLD_P2B_FOUR_UNITS,evaluateGoldP2BRelease,buildGoldP2BTransactionPlan} from '../../lib/gold-p2b-release-gate.mjs';

const args=process.argv.slice(2);
const planning=args.includes('--plan');
if(args.includes('--help')){
 console.log('Usage: node deploy/scripts/gold-p2b-four-service-orchestrator.mjs [--preflight|--plan] [--sha <40-char-hex>]');
 console.log('Read-only Gold UAT release gate. --apply is NOT implemented and always denied.');
 process.exit(0);
}
if(args.includes('--apply')||args.includes('--migrate')||args.includes('--rollback')){
 console.error('P2B_LIVE_CHANGE_UNIMPLEMENTED_SEPARATE_OWNER_APPROVAL_REQUIRED');
 process.exit(3);
}
if(args.some((arg,i)=>!['--preflight','--sha','--plan'].includes(arg)&&
 !(/^[a-f0-9]{40}$/.test(arg)&&args[i-1]==='--sha'))){
 console.error('P2B_PREFLIGHT_INVALID_ARGUMENTS');process.exit(2);
}
const shaAt=args.indexOf('--sha');
const sha=shaAt===-1?null:args[shaAt+1];
if(shaAt!==-1&&!/^[a-f0-9]{40}$/.test(sha||'')){
 console.error('P2B_CANDIDATE_SHA_INVALID');process.exit(2);
}
function readCommand(cmd,argv,timeout=6000){
 const r=spawnSync(cmd,argv,{encoding:'utf8',timeout,maxBuffer:100000,
   env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C'}});
 if(r.status!==0||r.error)return null;
 return r.stdout.trim();
}
function pgObservation(){
 const sql=[
 'SELECT json_build_object(',
 "'maxVersion',(SELECT max(version) FROM lr_schema_migrations),",
 "'migrationCount',(SELECT count(*) FROM lr_schema_migrations),",
 "'activeJobs',(SELECT count(*) FROM lr_gold_job_records WHERE status IN ('queued','running')),",
 "'unknownWork',(SELECT count(*) FROM lr_gold_personal_agent_work WHERE state='unknown'),",
 "'resourceClaims',(SELECT count(*) FROM lr_gold_device_resource_claims)",
 ')::text'].join(' ');
 const output=readCommand('runuser',['-u','postgres','--','psql','-d',
   'light_remote_gold_dev','-AtX','-v','ON_ERROR_STOP=1','-c',sql],8000);
 try{
  const j=JSON.parse(output);
  return {maxVersion:Number(j.maxVersion),migrationCount:Number(j.migrationCount),
   activeJobs:Number(j.activeJobs),unknownWork:Number(j.unknownWork),
   resourceClaims:Number(j.resourceClaims)};
 }catch{return {};}
}
function unitObservation(){
 return Object.fromEntries(GOLD_P2B_FOUR_UNITS.map(name=>{
  const active=readCommand('systemctl',['is-active',name]);
  const wd=readCommand('systemctl',['show',name,'-p','WorkingDirectory','--value']);
  return [name,{active:active==='active',workingDirectory:wd||null}];
 }));
}
async function fleetObservation(){
 const socket='/run/light-remote-gold-uat/operator.sock';
 if(!fs.existsSync(socket))return {signedIdle:false};
 try{
  const data=await new Promise((resolve,reject)=>{
   const req=http.get({socketPath:socket,path:'/v1/fleet',timeout:3000},res=>{
    let body='';res.on('data',v=>body+=v);
    res.on('end',()=>{
     if(res.statusCode!==200||body.length>50000)return reject(Error('fleet_unavailable'));
     resolve(body);
    });
   });
   req.on('timeout',()=>req.destroy(Error('timeout')));
   req.on('error',reject);
  });
  const f=JSON.parse(data);
  const idle=Array.isArray(f.nodes)&&f.nodes.every(n=>
   Number(n.activeSessions||0)===0&&Number(n.queuedCommands||0)===0&&
   Number(n.inFlightCommands||0)===0);
  // Fleet telemetry is not itself signed OS effect proof: deliberately HOLD.
  return {signedIdle:false,telemetryIdle:f.ok===true&&idle};
 }catch{return {signedIdle:false};}
}
function candidateObservation(){
 if(!sha)return {trackedShaVerified:false};
 const root=path.join('/opt/light-remote-gold-uat-candidates',sha);
 const marker=path.join(root,'.git-source-sha');
 const sums=path.join(root,'.git-tracked-SHA256SUMS');
 if(!fs.existsSync(marker)||!fs.existsSync(sums))return {trackedShaVerified:false};
 if(fs.readFileSync(marker,'utf8').trim()!==sha)return {trackedShaVerified:false};
 // Manifest presence is insufficient to claim verified package/signing.
 // This phase deliberately never promotes an artifact.
 return {trackedShaVerified:false,manifestSeen:true};
}
const observation={
 hostname:os.hostname(),database:pgObservation(),units:unitObservation(),
 fleet:await fleetObservation(),candidate:candidateObservation(),
 backup:{freshVerifiedPgDump:false,fourUnitPreimage:false,freshLxdSnapshot:false},
 redis:{authenticatedTtlReadback:false},
 featureFlags:{verifiedDisabled:false},
 signedEffects:{provenQuiescent:false},
 devices:{explicitlyAllowlisted:false},
};
const result=evaluateGoldP2BRelease(observation);
// Report contains counts and states only: no device IDs, keys or database rows.
console.log(JSON.stringify({
 ...result,
 ...(planning?{transactionBlueprint:buildGoldP2BTransactionPlan()}:{}),
 evidence:{database:observation.database,
  units:Object.fromEntries(Object.entries(observation.units).map(([k,v])=>
   [k,{active:v.active,
    sourceAligned:v.workingDirectory===observation.units[GOLD_P2B_FOUR_UNITS[0]]?.workingDirectory}])),
  fleetTelemetryIdle:observation.fleet?.telemetryIdle===true,
  candidateManifestSeen:observation.candidate?.manifestSeen===true}
},null,2));
if(result.status!=='READINESS_REVIEW_REQUIRED')process.exitCode=4;
