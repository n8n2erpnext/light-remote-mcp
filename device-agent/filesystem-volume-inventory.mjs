import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execFileAsync=promisify(execFile);

// Device-local inventory only. Never send volume names or paths to the cloud.
// Keep list bounded and avoid prompting for elevation during discovery.
const SYSTEM_FS=new Set(['proc','sysfs','devtmpfs','devpts','cgroup','cgroup2','tmpfs','squashfs','overlay','tracefs','securityfs','debugfs','pstore','mqueue','fusectl','configfs','autofs']);
let cached=null,cachedAt=0,inFlight=null;
function distinct(items){
  const result=[],seen=new Set();
  for(const x of items){if(!x?.path)continue;const normalized=path.resolve(x.path);if(seen.has(normalized))continue;seen.add(normalized);result.push({...x,path:normalized});}
  return result.slice(0,64);
}
async function windowsVolumes(){
  try{
    const script="$ErrorActionPreference='Stop'; Get-CimInstance -ClassName Win32_LogicalDisk | Where-Object { $_.DriveType -in @(2,3,4,5) } | Select-Object DeviceID,DriveType,VolumeName | ConvertTo-Json -Compress";
    // Do not block the Agent/Wall Node event loop while PowerShell/CIM probes
    // volumes. A slow Windows Storage provider previously stalled the whole
    // localhost HTTP server and Real Remote channel. Child is time-bounded.
    const {stdout}=await execFileAsync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],
      {encoding:'utf8',timeout:5000,windowsHide:true,maxBuffer:256*1024});
    const raw=stdout.trim();
    const parsed=JSON.parse(raw),rows=Array.isArray(parsed)?parsed:[parsed];
    return rows.filter(r=>/^[a-z]:$/i.test(String(r.DeviceID||''))).map(r=>({
      path:String(r.DeviceID).toUpperCase()+'\\',label:String(r.DeviceID).toUpperCase()+(r.VolumeName?' · '+String(r.VolumeName).slice(0,70):''),
      kind:Number(r.DriveType)===3?'fixed':Number(r.DriveType)===2?'removable':Number(r.DriveType)===4?'network':'optical'
    })).sort((a,b)=>a.path.localeCompare(b.path));
  }catch{
    // Fallback without synchronous drive probes. UNC roots are excluded by
    // filesystem root validation and must not be selected automatically.
    const rows=await Promise.all('CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async d=>{
      const drive=d+':\\';
      try{if((await fs.promises.stat(drive)).isDirectory())return {path:drive,label:d+':',kind:'drive'};}catch{}
      return null;
    }));
    return rows.filter(Boolean);
  }
}
function linuxVolumes(){
  const rows=[{path:os.homedir(),label:'Home folder',kind:'home'}];
  try{
    for(const line of fs.readFileSync('/proc/self/mountinfo','utf8').split('\n')){
      const parts=line.split(' - ');if(parts.length!==2)continue;
      const left=parts[0].split(' '),right=parts[1].split(' ');
      const type=right[0],source=right[1]||'';
      if(SYSTEM_FS.has(type)||!(/^(\/dev\/|\/mnt\/|\/media\/|\/run\/media\/)/.test(source)||left[4]==='/'))continue;
      const mount=left[4].replace(/\\040/g,' ');
      if(mount==='/'||mount.startsWith('/mnt/')||mount.startsWith('/media/')||mount.startsWith('/run/media/')||mount.startsWith('/home/'))
        rows.push({path:mount,label:mount,kind:'mount'});
    }
  }catch{}
  return rows;
}
function macVolumes(){
  const rows=[{path:os.homedir(),label:'Home folder',kind:'home'}];
  try{for(const name of fs.readdirSync('/Volumes')){const p=path.join('/Volumes',name);if(fs.statSync(p).isDirectory())rows.push({path:p,label:name,kind:'volume'});}}catch{}
  return rows;
}
export async function filesystemVolumeInventory({platform=process.platform,refresh=false,probeWindows=windowsVolumes}={}){
  const now=Date.now();
  if(!refresh&&cached?.platform===platform&&now-cachedAt<30000)return cached;
  if(inFlight?.platform===platform)return inFlight.promise;
  const promise=(async()=>{
    const volumes=distinct(platform==='win32'?await probeWindows():platform==='darwin'?macVolumes():linuxVolumes());
    const result={platform,volumes};
    cached=result;cachedAt=Date.now();return result;
  })();
  inFlight={platform,promise};
  try{return await promise;}finally{if(inFlight?.promise===promise)inFlight=null;}
}
