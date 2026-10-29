import os from 'node:os';
import {readFileSync,statSync} from 'node:fs';

// Non-executing Agent-local OS health observation. No shell, WMI command,
// scheduler job, process spawn or resource admission. Windows uptime is an
// OS-backed duration, NOT the Windows LastBootUpTime property or OS attestation.
const MAX_UPTIME_MS=10*365*24*60*60*1000;
const WMI_SOURCE='win32_wmi_lastbootuptime';
export function nativeWindowsBootFromHost(env=process.env,{sampledAtMs=Date.now()}={}){
  // Values are supplied only by the native Windows Agent launcher. An env
  // claim is NOT secure hardware attestation; never use it for M4/owner release.
  if(env.LIGHT_REMOTE_NATIVE_BOOT_SOURCE!==WMI_SOURCE)return null;
  const rawBoot=env.LIGHT_REMOTE_NATIVE_BOOT_AT_MS||'';
  const rawObserved=env.LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS||'';
  if(!/^\d{13}$/.test(rawBoot)||!/^\d{13}$/.test(rawObserved))return null;
  const nativeBootAtMs=Number(rawBoot),nativeObservedAtMs=Number(rawObserved);
  if(![nativeBootAtMs,nativeObservedAtMs,sampledAtMs].every(Number.isSafeInteger)||
    nativeBootAtMs<1577836800000||nativeBootAtMs>nativeObservedAtMs+30000||
    nativeObservedAtMs>sampledAtMs+30000||
    sampledAtMs-nativeObservedAtMs>90*86400000)return null;
  return {nativeSource:WMI_SOURCE,nativeBootAtMs,nativeObservedAtMs};
}
// Only the native host provides a unique per-daemon cache path. This read is
// bounded, never executes a command, and is not evidence to release M4 claims.
export function nativeWindowsBootFromRecoveryFile(env=process.env,{sampledAtMs=Date.now()}={}){
  const path=env.LIGHT_REMOTE_NATIVE_BOOT_RECOVERY_PATH;
  if(typeof path!=='string'||path.length>1024||
    !/[\\/]GPTOperatorAgent[\\/]native-boot-[a-f0-9]{32}\.json$/i.test(path))return null;
  try{
    const st=statSync(path);
    if(!st.isFile()||st.size>512)return null;
    const value=JSON.parse(readFileSync(path,'utf8'));
    if(!value||typeof value!=='object'||Array.isArray(value))return null;
    return nativeWindowsBootFromHost({
      LIGHT_REMOTE_NATIVE_BOOT_SOURCE:value.nativeSource,
      LIGHT_REMOTE_NATIVE_BOOT_AT_MS:String(value.nativeBootAtMs??''),
      LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS:String(value.nativeObservedAtMs??'')
    },{sampledAtMs});
  }catch{return null;}
}
export function sampleWindowsBootEvidence({platform=process.platform,clock=()=>Date.now(),uptime=()=>os.uptime(),agentUptime=()=>process.uptime(),nativeEnv=process.env}={}){
  if(platform!=='win32')return null;
  try{
    const sampledAtMs=clock(),systemUptimeMs=Math.round(uptime()*1000),agentUptimeMs=Math.round(agentUptime()*1000);
    if(!Number.isSafeInteger(sampledAtMs)||sampledAtMs<1577836800000||
      !Number.isSafeInteger(systemUptimeMs)||systemUptimeMs<5000||systemUptimeMs>MAX_UPTIME_MS||
      !Number.isSafeInteger(agentUptimeMs)||agentUptimeMs<0||
      agentUptimeMs>systemUptimeMs+5000)return null;
    const bootEstimateMs=sampledAtMs-systemUptimeMs;
    if(bootEstimateMs<1577836800000||bootEstimateMs>sampledAtMs)return null;
    const native=nativeWindowsBootFromHost(nativeEnv,{sampledAtMs})||
      nativeWindowsBootFromRecoveryFile(nativeEnv,{sampledAtMs});
    return {version:1,source:'win32_node_os_uptime',assurance:'estimate_only',
      sampledAtMs,systemUptimeMs,agentUptimeMs,bootEstimateMs,
      ...(native?{...native,nativeConsistency:
        Math.abs(native.nativeBootAtMs-bootEstimateMs)<=300000?'consistent':'divergent'}:{})};
  }catch{return null;}
}

// A device-authenticated observation is *not* a signed terminal receipt,
// physical OS-boot attestation, evidence of process exit or owner approval.
export function sanitizeWindowsBootEvidence(value,{now=Date.now(),maxAgeMs=120000}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||
    value.version!==1||value.source!=='win32_node_os_uptime'||
    value.assurance!=='estimate_only')return null;
  const {sampledAtMs,systemUptimeMs,agentUptimeMs,bootEstimateMs}=value;
  if(![sampledAtMs,systemUptimeMs,agentUptimeMs,bootEstimateMs].every(Number.isSafeInteger)||
    sampledAtMs>now+30000||sampledAtMs<now-maxAgeMs||
    systemUptimeMs<5000||systemUptimeMs>MAX_UPTIME_MS||
    agentUptimeMs<0||agentUptimeMs>systemUptimeMs+5000||
    bootEstimateMs<1577836800000||bootEstimateMs>sampledAtMs||
    Math.abs(sampledAtMs-systemUptimeMs-bootEstimateMs)>1500)return null;
  const hasNative=['nativeBootAtMs','nativeObservedAtMs','nativeSource','nativeConsistency']
    .some(k=>Object.hasOwn(value,k));
  let native=null;
  if(hasNative){
    native=nativeWindowsBootFromHost({
      LIGHT_REMOTE_NATIVE_BOOT_AT_MS:String(value.nativeBootAtMs??''),
      LIGHT_REMOTE_NATIVE_BOOT_OBSERVED_AT_MS:String(value.nativeObservedAtMs??''),
      LIGHT_REMOTE_NATIVE_BOOT_SOURCE:value.nativeSource
    },{sampledAtMs});
    if(!native||value.nativeConsistency!==
      (Math.abs(native.nativeBootAtMs-bootEstimateMs)<=300000?'consistent':'divergent'))
      return null;
  }
  return {version:1,source:value.source,assurance:value.assurance,
    sampledAtMs,systemUptimeMs,agentUptimeMs,bootEstimateMs,
    ...(native?{...native,nativeConsistency:value.nativeConsistency}:{})};
}
