/*
 * Private Gold Memory key permissions.
 * POSIX: owner-only 0600. Windows: enforce explicit owner SID ACL on NTFS
 * (Node fs.stat().mode does not describe Windows access control).
 * Failure is fatal; never fall back to an insecure key.
 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';

const secured=new Map();
function denied(code){return Object.assign(new Error(code),{status:503});}
export function requireGoldMemoryPrivateKey(file,code='gold_memory_private_key_permissions'){
  let stat=fs.statSync(file);
  if(!stat.isFile())throw denied(code);
  if(process.platform!=='win32'){
    if(stat.mode&0o077)throw denied(code);
    return;
  }
  const fingerprint=String(stat.ino)+':'+String(stat.mtimeMs)+':'+stat.size;
  if(secured.get(file)===fingerprint)return;
  try{
    const info=execFileSync('whoami.exe',['/user','/fo','csv','/nh'],{
      encoding:'utf8',timeout:5000,windowsHide:true,maxBuffer:4096});
    const sid=info.match(/S-1-\d+(?:-\d+)+/)?.[0];
    if(!sid)throw new Error('windows_user_sid_missing');
    // Do not inherit broad Users/Everyone/Authenticated Users access to keys.
    execFileSync('icacls.exe',[file,'/inheritance:r','/grant:r','*'+sid+':F',
      '/remove:g','*S-1-1-0','*S-1-5-11','*S-1-5-32-545'],{
      windowsHide:true,timeout:8000,maxBuffer:8192});
    secured.set(file,fingerprint);
  }catch{throw denied(code);}
}
