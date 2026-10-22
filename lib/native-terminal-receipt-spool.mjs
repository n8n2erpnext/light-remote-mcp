// Per-device, private terminal-only evidence for native Windows/macOS Agent
// jobs. This is a DEVICE journal, not a Gold server JSON runtime registry.
// A missing receipt means UNKNOWN; it never authorizes resource release.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const TERMINAL=new Set(['finished','stopped','timeout','error']);
const ownerValid=v=>/^[A-Za-z0-9._:-]{1,180}$/.test(String(v||''));
const idValid=v=>/^lp_[A-Za-z0-9_-]{20,80}$/.test(String(v||''));
const good=x=>x&&ownerValid(x.accountId)&&ownerValid(x.deviceId)&&idValid(x.processId)&&
  TERMINAL.has(x.state)&&Number.isSafeInteger(Number(x.finishedAt))&&Number(x.finishedAt)>0;
const limit=4096;
export class NativeTerminalReceiptSpool {
 constructor({directory,now=()=>Date.now()}={}){
  if(!path.isAbsolute(String(directory||'')))throw Error('terminal_spool_absolute_directory_required');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||
      (process.platform!=='win32'&&((stat.mode&0o077)!==0||
        (typeof process.getuid==='function'&&stat.uid!==process.getuid()))))
    throw Error('terminal_spool_private_directory_required');
  this.directory=directory;this.file=path.join(directory,'terminal-receipts-v1.json');this.now=now;this.rows=new Map();
  this.load();
 }
 load(){
  let payload;
  try{
   const stat=fs.lstatSync(this.file);
   if(!stat.isFile()||stat.isSymbolicLink()||
      (process.platform!=='win32'&&((stat.mode&0o077)!==0||
        (typeof process.getuid==='function'&&stat.uid!==process.getuid()))))
     throw Error('terminal_spool_file_permissions_invalid');
   payload=JSON.parse(fs.readFileSync(this.file,'utf8'));
  }catch(e){if(e.code==='ENOENT')return;throw e;}
  if(payload?.version!==1||!Array.isArray(payload.rows)||payload.rows.length>limit)
   throw Error('terminal_spool_corrupt');
  for(const row of payload.rows){
   if(!good(row)||this.rows.has(row.processId))throw Error('terminal_spool_invalid_or_duplicate');
   this.rows.set(row.processId,row);
  }
 }
 save(){
  const temp=path.join(this.directory,'.terminal-'+crypto.randomBytes(12).toString('hex')+'.tmp');
  let fd;
  try{
   fd=fs.openSync(temp,'wx',0o600);
   fs.writeFileSync(fd,JSON.stringify({version:1,rows:[...this.rows.values()]}));
   fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   // Windows rename-to-existing occasionally fails on transient file readers.
   // Do not fall back to non-atomic overwrite; preserve the old journal.
   fs.renameSync(temp,this.file);
   if(process.platform!=='win32'){
    const dirFd=fs.openSync(this.directory,'r');
    try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
   }
  }finally{
   if(fd!=null)try{fs.closeSync(fd);}catch{}
   try{fs.rmSync(temp,{force:true});}catch{}
  }
 }
 record(event){
  if(!good(event))throw Error('terminal_spool_invalid_terminal');
  const row={accountId:String(event.accountId),deviceId:String(event.deviceId),
   processId:String(event.processId),state:String(event.state),
   finishedAt:Number(event.finishedAt),exitCode:Number.isInteger(event.exitCode)?event.exitCode:null};
  const prev=this.rows.get(row.processId);
  if(prev){
   if(JSON.stringify(prev)!==JSON.stringify(row))throw Error('terminal_spool_process_conflict');
   return false;
  }
  if(this.rows.size>=limit)throw Error('terminal_spool_capacity_reached');
  this.rows.set(row.processId,row);
  try{this.save();}catch(e){this.rows.delete(row.processId);throw e;}
  return true;
 }
 list(accountId,deviceId){
  if(!ownerValid(accountId)||!ownerValid(deviceId))throw Error('terminal_spool_scope_invalid');
  return [...this.rows.values()].filter(r=>r.accountId===accountId&&r.deviceId===deviceId)
   .slice(0,32).map(r=>({processId:r.processId,state:r.state,finishedAt:r.finishedAt,exitCode:r.exitCode}));
 }
 acknowledge(accountId,deviceId,receipts){
  if(!ownerValid(accountId)||!ownerValid(deviceId)||!Array.isArray(receipts)||receipts.length>32)
   throw Error('terminal_spool_ack_scope_invalid');
  const seen=new Set(),remove=[];
  for(const receipt of receipts){
   if(!good({...receipt,accountId,deviceId}))throw Error('terminal_spool_ack_invalid');
   if(seen.has(receipt.processId))throw Error('terminal_spool_ack_duplicate');
   seen.add(receipt.processId);
   const row=this.rows.get(receipt.processId);
   if(!row)continue; // Replay of an ACK already fsynced locally.
   if(row.accountId!==accountId||row.deviceId!==deviceId||row.state!==receipt.state||
      row.finishedAt!==Number(receipt.finishedAt))
    throw Error('terminal_spool_ack_mismatch');
   remove.push(row);
  }
  if(!remove.length)return 0;
  for(const row of remove)this.rows.delete(row.processId);
  try{this.save();}catch(e){for(const row of remove)this.rows.set(row.processId,row);throw e;}
  return remove.length;
 }
}
