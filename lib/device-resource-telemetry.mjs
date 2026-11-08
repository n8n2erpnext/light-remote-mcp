import os from 'node:os';
import fs from 'node:fs';

// Bounded read-only metrics from the device process. Host CPU/RAM are host
// measurements; process CPU/RSS and fs I/O are explicitly Agent-only.
const cpuTotals=cpus=>{
 let busy=0,total=0;
 for(const c of cpus||[]){
  const t=c?.times||{},idle=Number(t.idle)||0;
  for(const v of Object.values(t))total+=Number(v)||0;
  busy+=Object.values(t).reduce((s,v)=>s+(Number(v)||0),0)-idle;
 }
 return {busy,total};
};
const percent=(a,b)=>Math.max(0,Math.min(100,Math.round((100*a/b)*10)/10));
const finiteCount=n=>Number.isSafeInteger(n)&&n>=0?n:null;
function linuxIo(){
 if(process.platform!=='linux')return null;
 try{
  const text=fs.readFileSync('/proc/self/io','utf8'),values={};
  for(const line of text.split('\n')){const m=line.match(/^([a-z_]+):\s*(\d+)$/);if(m)values[m[1]]=Number(m[2]);}
  return {readBytes:finiteCount(values.read_bytes),writeBytes:finiteCount(values.write_bytes)};
 }catch{return null;}
}
export class DeviceResourceSampler {
 constructor({clock=()=>Date.now(),cpus=()=>os.cpus(),totalmem=()=>os.totalmem(),
  freemem=()=>os.freemem(),cpuUsage=()=>process.cpuUsage(),memoryUsage=()=>process.memoryUsage(),
  resourceUsage=()=>process.resourceUsage(),diskIo=linuxIo}={}){
  Object.assign(this,{clock,cpus,totalmem,freemem,cpuUsage,memoryUsage,resourceUsage,diskIo});
  this.prev=null;
 }
 sample(){
  const sampledAt=this.clock();
  let cpu,own,usage,mem,io;
  try{cpu=cpuTotals(this.cpus());}catch{cpu=null;}
  try{own=this.cpuUsage();}catch{own=null;}
  try{usage=this.resourceUsage();}catch{usage=null;}
  try{mem=this.memoryUsage();}catch{mem=null;}
  try{io=this.diskIo();}catch{io=null;}
  const total=finiteCount(this.totalmem()),free=finiteCount(this.freemem());
  const previous=this.prev,elapsed=previous?sampledAt-previous.sampledAt:null;
  const sensible=Number.isFinite(elapsed)&&elapsed>=1000&&elapsed<=300000;
  const delta=(v,p)=>sensible&&Number.isSafeInteger(v)&&Number.isSafeInteger(p)&&v>=p?v-p:null;
  const cpuBusy=delta(cpu?.busy,previous?.cpu?.busy),cpuTotal=delta(cpu?.total,previous?.cpu?.total);
  const ownMicro=delta((own?.user||0)+(own?.system||0),
                        (previous?.own?.user||0)+(previous?.own?.system||0));
  const fsReads=delta(usage?.fsRead,previous?.usage?.fsRead);
  const fsWrites=delta(usage?.fsWrite,previous?.usage?.fsWrite);
  const readBytes=delta(io?.readBytes,previous?.io?.readBytes);
  const writeBytes=delta(io?.writeBytes,previous?.io?.writeBytes);
  this.prev={sampledAt,cpu,own,usage,io};
  return {
   version:1,sampledAt,windowMs:sensible?elapsed:null,
   hostCpuPercent:cpuTotal>0&&cpuBusy!=null?percent(cpuBusy,cpuTotal):null,
   hostMemoryTotalBytes:total,hostMemoryUsedBytes:total!=null&&free!=null&&free<=total?total-free:null,
   agentCpuPercent:ownMicro!=null?percent(ownMicro/1000,elapsed):null,
   agentRssBytes:finiteCount(mem?.rss),
   agentFsReadOps:fsReads,agentFsWriteOps:fsWrites,
   agentDiskReadBytes:readBytes,agentDiskWriteBytes:writeBytes,
   ioScope:'agent_process',hostScope:'host'
  };
 }
}

// Strict parsing prevents a signed device from injecting large/malformed
// objects or claiming realtime values long after sampling.
export function sanitizeDeviceResourceSample(value,{now=Date.now(),maxAgeMs=120000}={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1)return null;
 const t=value.sampledAt;
 if(!Number.isSafeInteger(t)||t>now+30000||t<now-maxAgeMs)return null;
 const numeric=(key,max)=>{const v=value[key];return v===null||v===undefined?null:
  typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:null;};
 const pct=k=>numeric(k,100);
 const count=k=>numeric(k,Number.MAX_SAFE_INTEGER);
 const window=numeric('windowMs',300000);
 const sample={
  version:1,sampledAt:t,receivedAt:now,windowMs:window,
  hostCpuPercent:pct('hostCpuPercent'),
  hostMemoryTotalBytes:count('hostMemoryTotalBytes'),
  hostMemoryUsedBytes:count('hostMemoryUsedBytes'),
  agentCpuPercent:pct('agentCpuPercent'),
  agentRssBytes:count('agentRssBytes'),
  agentFsReadOps:count('agentFsReadOps'),agentFsWriteOps:count('agentFsWriteOps'),
  agentDiskReadBytes:count('agentDiskReadBytes'),
  agentDiskWriteBytes:count('agentDiskWriteBytes'),
  ioScope:'agent_process',hostScope:'host'
 };
 if(sample.hostMemoryTotalBytes!=null&&sample.hostMemoryUsedBytes!=null&&
    sample.hostMemoryUsedBytes>sample.hostMemoryTotalBytes)return null;
 return sample;
}
export class DeviceResourceSampleCache {
 constructor({maxDevices=250,ttlMs=90000,now=()=>Date.now()}={}){
  this.maxDevices=maxDevices;this.ttlMs=ttlMs;this.now=now;this.rows=new Map();
 }
 record({accountId,deviceId,value}={}){
  if(!accountId||!deviceId)return false;
  const sample=sanitizeDeviceResourceSample(value,{now:this.now()});
  if(!sample)return false;
  const key=accountId+'\0'+deviceId,prior=this.rows.get(key);
  if(prior&&sample.sampledAt<prior.sampledAt)return false;
  if(!prior&&this.rows.size>=this.maxDevices){
   for(const [k,v] of this.rows)if(this.now()-v.receivedAt>this.ttlMs)this.rows.delete(k);
   if(this.rows.size>=this.maxDevices)return false;
  }
  this.rows.set(key,sample);return true;
 }
 get(accountId,deviceId){
  const v=this.rows.get(accountId+'\0'+deviceId);
  if(!v)return {state:'unknown',sample:null};
  const age=this.now()-v.receivedAt;
  if(age>this.ttlMs)return {state:'stale',sample:{...v}};
  return {state:'fresh',sample:{...v}};
 }
}
