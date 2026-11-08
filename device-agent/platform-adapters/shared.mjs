import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function uniqueCapabilities(values = []) {
  return [...new Set(values.filter(Boolean).map(value => String(value)))].sort();
}

// Windows Local Wall status requests run on the Agent's Node event loop.
// Never spawn where.exe for each /api/status, /api/policy-status or inventory
// refresh: synchronous processes can hold up all HTTP requests/SSE during RM.
const windowsCommandCache=new Map();
export function invalidateCommandExistenceCache(){windowsCommandCache.clear();}
function windowsExecutableOnPath(safe){
  const pathValue=String(process.env.Path||process.env.PATH||'');
  const pathExt=String(process.env.PATHEXT||'.COM;.EXE;.BAT;.CMD');
  const key=pathValue+'|'+pathExt+'|'+safe.toLowerCase();
  const now=Date.now(),cached=windowsCommandCache.get(key);
  if(cached&&cached.until>now)return cached.found;
  const suffixes=/\.[A-Za-z0-9]+$/.test(safe)?['']:pathExt.split(';').map(x=>x.trim()).filter(x=>/^\.[A-Za-z0-9]+$/.test(x));
  let found=false;
  for(const raw of pathValue.split(';')){
    const dir=raw.trim().replace(/^"(.+)"$/,'$1');
    // Never synchronously touch remote UNC shares from the local HTTP lane.
    if(!dir||dir.startsWith('\\\\')||dir.startsWith('//'))continue;
    for(const ext of suffixes){
      try{if(fs.statSync(path.join(dir,safe+ext)).isFile()){found=true;break;}}catch{}
    }
    if(found)break;
  }
  if(windowsCommandCache.size>256)windowsCommandCache.clear();
  windowsCommandCache.set(key,{found,until:now+60_000});
  return found;
}
export function defaultCommandExists(platform, name) {
  const safe=String(name||'').replace(/[^A-Za-z0-9._-]/g,'');
  if (!safe) return false;
  if(platform==='win32')return windowsExecutableOnPath(safe);
  return spawnSync('sh',['-lc',`command -v ${safe}`],{stdio:'ignore',timeout:1500}).status===0;
}

export function inferCapabilities(script, rules = []) {
  // Normalize only standard executable directories for *capability
  // inference*. Keep the original script unchanged for execution. Without
  // this, /usr/bin/sudo, /usr/bin/systemctl, /usr/bin/git, etc. bypassed
  // the same per-command capability detection as their bare equivalents.
  // This normalization only ADDS requirements; it never grants authority.
  const text=String(script||'').replace(
    /(^|[;&|\s"'`])(?:\/(?:usr\/)?(?:local\/)?s?bin\/|\/opt\/homebrew\/bin\/)([A-Za-z0-9._+-]+)(?=\s|$|[;&|"'`])/g,
    '$1$2');
  const out=[];
  for (const [capability, pattern] of rules) {
    if (pattern.test(text)) out.push(capability);
  }
  return uniqueCapabilities(out);
}

export function firstAvailable(commandExists, names = []) {
  return names.find(name => commandExists(name)) || null;
}
