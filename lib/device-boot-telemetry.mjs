import os from 'node:os';

// Non-executing Agent-local OS health observation. No shell, WMI command,
// scheduler job, process spawn or resource admission. Windows uptime is an
// OS-backed duration, NOT the Windows LastBootUpTime property or OS attestation.
const MAX_UPTIME_MS=10*365*24*60*60*1000;
export function sampleWindowsBootEvidence({platform=process.platform,clock=()=>Date.now(),uptime=()=>os.uptime(),agentUptime=()=>process.uptime()}={}){
  if(platform!=='win32')return null;
  try{
    const sampledAtMs=clock(),systemUptimeMs=Math.round(uptime()*1000),agentUptimeMs=Math.round(agentUptime()*1000);
    if(!Number.isSafeInteger(sampledAtMs)||sampledAtMs<1577836800000||
      !Number.isSafeInteger(systemUptimeMs)||systemUptimeMs<5000||systemUptimeMs>MAX_UPTIME_MS||
      !Number.isSafeInteger(agentUptimeMs)||agentUptimeMs<0||
      agentUptimeMs>systemUptimeMs+5000)return null;
    const bootEstimateMs=sampledAtMs-systemUptimeMs;
    if(bootEstimateMs<1577836800000||bootEstimateMs>sampledAtMs)return null;
    return {version:1,source:'win32_node_os_uptime',assurance:'estimate_only',
      sampledAtMs,systemUptimeMs,agentUptimeMs,bootEstimateMs};
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
  return {version:1,source:value.source,assurance:value.assurance,
    sampledAtMs,systemUptimeMs,agentUptimeMs,bootEstimateMs};
}
