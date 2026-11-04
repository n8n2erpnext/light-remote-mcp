#!/usr/bin/env node
/**
 * Isolated GoldABV2 Lab rollback preflight. Read only.
 * It DOES NOT stage, migrate, modify systemd, arm an auto-off timer,
 * create snapshots, or authorize cutover.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const LAB='light-remote-abv2-lab-20261101';
const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const TIMER='lr-t04b8-a2-source-autooff-20261104.timer';
const BACKUP='/home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/backup';
const ROLLBACK='/home/ubuntu/handoffs/T04B8_A2_REAL_LAB_20261104/source-cutover-rollback.sh';
const HEALTH='https://goldabv2.light-remote.thaiduy.digital/healthz';
const SOURCE='source-9d996956-desktop-owner-';
const UNIT_NAMES=Object.freeze(['light-remote-gold-plugin',
  'light-remote-gold-operator','light-remote-gold-wall',
  'light-remote-gold-process-supervisor']);
const exec=(bin,args,opts={})=>execFileSync(bin,args,{encoding:'utf8',timeout:18000,
  maxBuffer:1024*512,...opts}).trim();
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');

export function evaluateRollbackReadiness({
  backupsVerified=false,rollbackCheckPassed=false,
  snapshotCount=0,freshSnapshot=false,
  timerLoaded=false,timerActive=false,timerScheduled=false,
  unitsActive=[],baselineSourcesRestored=false,
  publicHttpsCode=0,tlsVerifyResult=-1,
  diskFreeBytes=0,diskUsagePercent=100
}={}){
  const blockers=[];
  if(!backupsVerified)blockers.push('backup_sha256_verification_missing');
  if(!rollbackCheckPassed)blockers.push('rollback_check_failed');
  if(snapshotCount<1)blockers.push('no_lab_snapshot');
  if(!freshSnapshot)blockers.push('fresh_pre_cutover_snapshot_required');
  if(!timerLoaded)blockers.push('independent_autooff_timer_not_loaded');
  if(!timerActive)blockers.push('independent_autooff_timer_not_active');
  if(!timerScheduled)blockers.push('independent_autooff_timer_no_future_deadline');
  if(UNIT_NAMES.some((n,i)=>unitsActive[i]!=='active'))
    blockers.push('lab_four_units_not_all_active');
  if(!baselineSourcesRestored)blockers.push('baseline_plugin_operator_source_unverified');
  if(publicHttpsCode!==200||tlsVerifyResult!==0)
    blockers.push('public_https_or_tls_health_not_verified');
  // For the already nearly full VPS ARM, require extra headroom before LXD snapshot.
  if(diskFreeBytes<10*1024**3||diskUsagePercent>85)
    blockers.push('vps_arm_storage_headroom_below_cutover_policy');
  return Object.freeze({
    status:blockers.length?'BLOCKED':'TECHNICAL_ROLLBACK_READY_APPROVAL_STILL_REQUIRED',
    canCutover:false,releaseApproved:false,canEnableSso:false,
    targetLab:LAB,snapshotCount,publicHttpsCode,tlsVerifyResult,
    storageFreeGiB:Math.round(diskFreeBytes/1024**3*10)/10,
    storageUsedPercent:Math.round(diskUsagePercent*10)/10,
    backupSha256Verified:backupsVerified,
    rollbackScriptCheckPassed:rollbackCheckPassed,
    timerLoaded,timerActive,timerScheduled,
    blockers
  });
}
export function rollbackCheckIsClean(output){
  if(typeof output!=='string'||!output.includes('rollback target: isolated Lab only'))
    return false;
  const statuses=output.split(/\r?\n/).filter(line=>
    /^(?:PRESENT|NOT_APPLIED): /.test(line));
  if(statuses.length!==2||statuses.some(line=>!line.startsWith('NOT_APPLIED: ')))
    return false;
  for(const unit of ['light-remote-gold-plugin','light-remote-gold-operator']){
    if(statuses.filter(line=>line.startsWith(
      'NOT_APPLIED: /etc/systemd/system/'+unit+'.service.d/')).length!==1)
      return false;
  }
  return true;
}
function backupsVerified(){
  const entries=fs.readFileSync(path.join(BACKUP,'SHA256SUMS'),'utf8')
    .trim().split(/\r?\n/);
  if(entries.length!==3)return false;
  return entries.every(line=>{
    const m=line.match(/^([a-f0-9]{64})  (\/home\/ubuntu\/handoffs\/T04B8_A2_REAL_LAB_20261104\/backup\/[^/]+)$/);
    if(!m||!fs.existsSync(m[2]))return false;
    return sha(fs.readFileSync(m[2]))===m[1];
  });
}
function snapshotReport(){
  // LXD CLI in this environment has no JSON --format for info/snapshot list.
  // Parse the LXD-rendered snapshot table strictly; fail closed on changed output.
  const out=exec('lxc',['info',LAB]);
  const snapshots=[...out.matchAll(/^\|\s*(pre-[A-Za-z0-9._-]+)\s*\|\s*(\d{4}\/\d\d\/\d\d \d\d:\d\d [+-]\d\d)\s*\|/gm)];
  let freshSnapshot=false;
  for(const match of snapshots){
    const d=match[2],iso=d.slice(0,10).replaceAll('/','-')+'T'+d.slice(11,16)+':00'+d.slice(17)+':00';
    const timestamp=Date.parse(iso);
    const age=Date.now()-timestamp;
    // Time window 2h; never treat future timestamp as ready.
    if(Number.isFinite(age)&&age>=0&&age<=2*60*60*1000)
      freshSnapshot=true;
  }
  return {snapshotCount:snapshots.length,freshSnapshot};
}
function timerReport(){
  const txt=exec('systemctl',['show',TIMER,'-p','LoadState','-p','ActiveState',
    '-p','NextElapseUSecRealtime','--no-pager']);
  const fields=Object.fromEntries(txt.split('\n').map(l=>l.split('=',2)));
  const deadline=fields.NextElapseUSecRealtime;
  const deadlineTime=deadline?Date.parse(deadline):NaN;
  return {
    timerLoaded:fields.LoadState==='loaded',
    timerActive:fields.ActiveState==='active',
    timerScheduled:Number.isFinite(deadlineTime)&&deadlineTime>Date.now()
  };
}
function healthReport(){
  const results=exec('lxc',['exec',LAB,'--','systemctl','is-active',...UNIT_NAMES])
    .split('\n').map(v=>v.trim());
  const operator=exec('lxc',['exec',LAB,'--','systemctl','show',
    'light-remote-gold-operator','-p','ExecStart','--no-pager']);
  const plugin=exec('lxc',['exec',LAB,'--','systemctl','show',
    'light-remote-gold-plugin','-p','ExecStart','--no-pager']);
  const baselineSourcesRestored=operator.includes(SOURCE+'operator-STAGED')&&
    plugin.includes(SOURCE+'plugin-STAGED');
  const probe=exec('curl',['-fsS','--max-time','9','-o','/dev/null',
    '-w','%{http_code}:%{ssl_verify_result}',HEALTH]);
  const [code,tls]=probe.split(':').map(Number);
  return {unitsActive:results,baselineSourcesRestored,
    publicHttpsCode:code,tlsVerifyResult:tls};
}
function storageReport(){
  const {bsize,blocks,bfree,bavail}=fs.statfsSync('/');
  const capacity=blocks*bsize,available=bavail*bsize,used=capacity-bfree*bsize;
  return {diskFreeBytes:available,diskUsagePercent:100*used/capacity};
}
function run(){
  if(process.argv.length!==3||process.argv[2]!=='--audit'){
    console.error('LAB_ROLLBACK_READ_ONLY_USAGE: --audit (no --apply/--arm/--snapshot)');
    process.exitCode=2;return;
  }
  try{
    const check=exec('bash',[ROLLBACK,'--check']);
    const result=evaluateRollbackReadiness({
      backupsVerified:backupsVerified(),
      rollbackCheckPassed:rollbackCheckIsClean(check),
      ...snapshotReport(),...timerReport(),...healthReport(),...storageReport()
    });
    console.log(JSON.stringify(result,null,2));
    if(result.status==='BLOCKED')process.exitCode=3;
  }catch{
    console.error('LAB_ROLLBACK_READ_ONLY_EVIDENCE_UNAVAILABLE');
    process.exitCode=4;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  run();
