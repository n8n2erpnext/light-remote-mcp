import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Device-local inventory only. Never send volume names or paths to the cloud.
// Keep list bounded and avoid prompting for elevation during discovery.
const SYSTEM_FS=new Set(['proc','sysfs','devtmpfs','devpts','cgroup','cgroup2','tmpfs','squashfs','overlay','tracefs','securityfs','debugfs','pstore','mqueue','fusectl','configfs','autofs']);
let cached=null,cachedAt=0;
function distinct(items){
  const result=[],seen=new Set();
  for(const x of items){if(!x?.path)continue;const normalized=path.resolve(x.path);if(seen.has(normalized))continue;seen.add(normalized);result.push({...x,path:normalized});}
  return result.slice(0,64);
}
function windowsVolumes(){
  try{
    const script="$ErrorActionPreference='Stop'; Get-CimInstance -ClassName Win32_LogicalDisk | Where-Object { $_.DriveType -in @(2,3,4,5) } | Select-Object DeviceID,DriveType,VolumeName | ConvertTo-Json -Compress";
    const raw=execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{encoding:'utf8',timeout:6000,windowsHide:true,maxBuffer:256*1024}).trim();
    const parsed=JSON.parse(raw),rows=Array.isArray(parsed)?parsed:[parsed];
    return rows.filter(r=>/^[a-z]:$/i.test(String(r.DeviceID||''))).map(r=>({
      path:String(r.DeviceID).toUpperCase()+'\\',label:String(r.DeviceID).toUpperCase()+(r.VolumeName?' · '+String(r.VolumeName).slice(0,70):''),
      kind:Number(r.DriveType)===3?'fixed':Number(r.DriveType)===2?'removable':Number(r.DriveType)===4?'network':'optical'
    })).sort((a,b)=>a.path.localeCompare(b.path));
  }catch{return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(d=>fs.existsSync(d+':\\')).map(d=>({path:d+':\\',label:d+':',kind:'drive'}));}
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
export function filesystemVolumeInventory({platform=process.platform,refresh=false}={}){
  const now=Date.now();
  if(!refresh&&cached?.platform===platform&&now-cachedAt<30000)return cached;
  const volumes=distinct(platform==='win32'?windowsVolumes():platform==='darwin'?macVolumes():linuxVolumes());
  cached={platform,volumes};cachedAt=now;return cached;
}
