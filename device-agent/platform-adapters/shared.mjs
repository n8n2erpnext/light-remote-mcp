import { spawnSync } from 'node:child_process';

export function uniqueCapabilities(values = []) {
  return [...new Set(values.filter(Boolean).map(value => String(value)))].sort();
}

export function defaultCommandExists(platform, name) {
  const safe=String(name||'').replace(/[^A-Za-z0-9._-]/g,'');
  if (!safe) return false;
  const command=platform==='win32' ? 'where' : 'sh';
  const args=platform==='win32' ? [safe] : ['-lc',`command -v ${safe}`];
  return spawnSync(command,args,{stdio:'ignore'}).status===0;
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
