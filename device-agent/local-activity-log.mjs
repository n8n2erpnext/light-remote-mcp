/*
 * Device-local, bounded, crash-recoverable Wall activity history.
 * Never writes to cloud, Codex, Long Memory or another device's directory.
 * All paths derive exclusively from the locally enrolled device ID.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const MiB=1024*1024;
const DEFAULT='standard';
export const ACTIVITY_LOG_PRESETS=Object.freeze({
  compact:{fileBytes:16*MiB,archives:2},
  standard:{fileBytes:50*MiB,archives:3},
  extended:{fileBytes:50*MiB,archives:5}
});
const MAX_EVENTS=5000,MAX_RING_BYTES=8*MiB,MAX_AGE_MS=3600000;
const MAX_EVENT_BYTES=64*1024,FLUSH_MS=50,BATCH_BYTES=256*1024;
const MIN_FREE_BYTES=512*MiB;
function fail(code,status=400){return Object.assign(new Error(code),{status});}
const tokenRE=/^[A-Za-z0-9._:-]{1,160}$/;
function redact(value){
  return String(value).replace(/(authorization\s*[:=]\s*bearer\s+)\S+/ig,'$1[REDACTED]')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/-]{20,}/ig,'$1[REDACTED]')
    .replace(/-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,'[REDACTED PRIVATE KEY]')
    .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*[:=]\s*)[^\s"']+/ig,'$1[REDACTED]');
}
function safeEvent(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const e={...raw};
  for(const k of ['script','stdout','stderr','chunk','note','resultSummary','cwd']){
    if(e[k]!=null){const text=redact(e[k]);e[k]=text.length>48000?text.slice(0,48000)+' [LOG FIELD TRUNCATED]':text;}
  }
  let encoded;try{encoded=JSON.stringify(e);}catch{return null;}
  if(Buffer.byteLength(encoded)>MAX_EVENT_BYTES){
    for(const k of ['chunk','stdout','stderr','script','note','resultSummary','toolMeta','cwd'])delete e[k];
    e.logTruncated=true;encoded=JSON.stringify(e);
  }
  return Buffer.byteLength(encoded)<=MAX_EVENT_BYTES?{event:e,line:encoded+'\n',bytes:Buffer.byteLength(encoded)+1}:null;
}
function strictFile(file){
  try{const info=fs.lstatSync(file);if(info.isSymbolicLink()||!info.isFile())throw fail('activity_log_path_unsafe',503);}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
function mkdirPrivate(dir){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  if(fs.lstatSync(dir).isSymbolicLink())throw fail('activity_log_directory_unsafe',503);
  if(process.platform!=='win32')fs.chmodSync(dir,0o700);
}
function readTail(file,maxBytes=MAX_RING_BYTES){
  if(!fs.existsSync(file))return '';
  strictFile(file);
  const stat=fs.statSync(file),size=Math.min(maxBytes,stat.size);
  const buf=Buffer.alloc(size),fd=fs.openSync(file,'r');
  try{fs.readSync(fd,buf,0,size,stat.size-size);}finally{fs.closeSync(fd);}
  const raw=buf.toString('utf8');
  return stat.size>size?raw.slice(raw.indexOf('\n')+1):raw;
}
function archiveTail(file,maxBytes=MAX_RING_BYTES){
  if(!fs.existsSync(file))return '';
  strictFile(file);
  const decoded=zlib.gunzipSync(fs.readFileSync(file),{maxOutputLength:51*MiB});
  const truncated=decoded.length>maxBytes;
  const text=decoded.subarray(-maxBytes).toString('utf8');
  return truncated?text.slice(text.indexOf('\n')+1):text;
}
function readSettings(dir){
  const file=path.join(dir,'settings.json');
  if(!fs.existsSync(file))return {preset:DEFAULT,purgedBefore:0};
  strictFile(file);
  let data;try{data=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw fail('activity_log_settings_corrupt',503);}
  if(!Object.hasOwn(ACTIVITY_LOG_PRESETS,data.preset)||
    !Number.isSafeInteger(data.purgedBefore)||data.purgedBefore<0)
    throw fail('activity_log_settings_invalid',503);
  return {preset:data.preset,purgedBefore:data.purgedBefore};
}
function saveSettings(dir,settings){
  const name=path.join(dir,'settings.json'),tmp=path.join(dir,'settings.tmp');
  strictFile(name);strictFile(tmp);
  fs.writeFileSync(tmp,JSON.stringify(settings)+'\n',{mode:0o600,flag:'w'});
  fs.renameSync(tmp,name);
  if(process.platform!=='win32')fs.chmodSync(name,0o600);
}
export class DeviceLocalActivityLog {
  constructor({root,deviceId,now=()=>Date.now()}={}){
    if(!path.isAbsolute(root)||!tokenRE.test(deviceId))throw fail('activity_log_identity_required');
    this.root=path.join(root,deviceId);this.now=now;mkdirPrivate(this.root);
    this.file=path.join(this.root,'activity.jsonl');this.settings=readSettings(this.root);
    this.ring=[];this.ringBytes=0;this.keys=new Set();this.pending=[];this.pendingBytes=0;
    this.flushTimer=null;this.lastError=null;
    this.restore();
  }
  config(){return {...this.settings,...ACTIVITY_LOG_PRESETS[this.settings.preset]};}
  stat(){
    const sizes=[];for(const file of this.files())if(fs.existsSync(file)){strictFile(file);sizes.push({name:path.basename(file),bytes:fs.statSync(file).size});}
    return {preset:this.settings.preset,fileLimitBytes:this.config().fileBytes,
      archives:this.config().archives,maxDiskBytes:this.config().fileBytes*(this.config().archives+1),
      usedBytes:sizes.reduce((n,f)=>n+f.bytes,0),files:sizes,
      ramEvents:this.ring.length,ramBytes:this.ringBytes,lastError:this.lastError,
      directory:this.root};
  }
  files(){
    const result=[this.file];
    for(let i=1;i<=5;i++)result.push(this.file+'.'+i+'.gz');
    return result;
  }
  restore(){
    // Rebuild the bounded in-memory timeline from local disk after restart.
    // Include rotated archives: the newest commands may have rotated just
    // before a crash, otherwise reopening the Wall would show gaps.
    const all=[];
    for(let i=this.config().archives;i>=1;i--)
      all.push(this.file+'.'+i+'.gz');
    all.push(this.file);
    for(const file of all){
      let contents;
      try{contents=file.endsWith('.gz')?archiveTail(file):readTail(file);}
      catch(e){this.lastError='activity_log_archive_read_failed';continue;}
      for(const line of contents.split('\n')){
        if(!line.trim())continue;let event;try{event=JSON.parse(line);}catch{continue;}
        this.remember(event);
      }
    }
  }
  history(limit=100){
    this.flush();
    const max=Math.max(1,Math.min(Number(limit)||100,200)),found=[],keys=new Set();
    const files=[this.file];
    for(let i=1;i<=this.config().archives;i++)files.push(this.file+'.'+i+'.gz');
    for(const file of files){
      let source;
      try{source=file.endsWith('.gz')?archiveTail(file):readTail(file);}
      catch(e){this.lastError='activity_log_archive_read_failed';continue;}
      const lines=source.split('\n');
      for(let i=lines.length-1;i>=0&&found.length<max;i--){
        if(!lines[i].trim())continue;
        let event;try{event=JSON.parse(lines[i]);}catch{continue;}
        const key=String(event?.id??'')+'@'+String(event?.at??'');
        if(keys.has(key))continue;
        keys.add(key);found.push(event);
      }
      if(found.length>=max)break;
    }
    return found.reverse();
  }
  remember(event){
    if(!event?.at||!event?.type)return false;
    const ms=Date.parse(event.at);if(!Number.isFinite(ms)||ms<=this.settings.purgedBefore||
      ms<this.now()-MAX_AGE_MS||ms>this.now()+60000)return false;
    const key=String(event.id??'')+'@'+String(event.at)+'@'+String(event.jobId??'')+'@'+String(event.type);
    if(this.keys.has(key))return false;
    const serialized=JSON.stringify(event),bytes=Buffer.byteLength(serialized);
    if(bytes>MAX_EVENT_BYTES)return false;
    this.ring.push({event,key,bytes,ms});this.keys.add(key);this.ringBytes+=bytes;
    this.prune();return true;
  }
  prune(){
    const cutoff=this.now()-MAX_AGE_MS;
    while(this.ring.length&&(this.ring.length>MAX_EVENTS||this.ringBytes>MAX_RING_BYTES||
      this.ring[0].ms<cutoff)){
      const x=this.ring.shift();this.keys.delete(x.key);this.ringBytes-=x.bytes;
    }
  }
  add(raw){
    const item=safeEvent(raw);
    if(!item||!this.remember(item.event))return false;
    this.pending.push(item.line);this.pendingBytes+=item.bytes;
    if(this.pendingBytes>=BATCH_BYTES)this.flush();
    else if(!this.flushTimer){this.flushTimer=setTimeout(()=>this.flush(),FLUSH_MS);this.flushTimer.unref?.();}
    return true;
  }
  recent(limit=500){
    this.prune();const n=Math.max(1,Math.min(Number(limit)||500,MAX_EVENTS));
    return this.ring.slice(-n).map(x=>x.event);
  }
  freeSpaceOK(){
    if(typeof fs.statfsSync!=='function')return true;
    const st=fs.statfsSync(this.root);
    return Number(st.bavail)*Number(st.bsize)>=MIN_FREE_BYTES;
  }
  rotate(){
    const max=this.config().archives;
    for(let i=5;i>max;i--)try{fs.rmSync(this.file+'.'+i+'.gz',{force:true});}catch{}
    fs.rmSync(this.file+'.'+max+'.gz',{force:true});
    for(let i=max-1;i>=1;i--){
      const old=this.file+'.'+i+'.gz',newer=this.file+'.'+(i+1)+'.gz';
      if(fs.existsSync(old)){strictFile(old);fs.renameSync(old,newer);}
    }
    if(fs.existsSync(this.file)&&fs.statSync(this.file).size){
      strictFile(this.file);
      const compressed=zlib.gzipSync(fs.readFileSync(this.file),{level:zlib.constants.Z_BEST_SPEED});
      fs.writeFileSync(this.file+'.1.gz',compressed,{mode:0o600,flag:'wx'});
      fs.truncateSync(this.file,0);
    }
  }
  flush(){
    if(this.flushTimer){clearTimeout(this.flushTimer);this.flushTimer=null;}
    if(!this.pending.length)return;
    const payload=this.pending.join('');this.pending=[];this.pendingBytes=0;
    try{
      strictFile(this.file);
      const bytes=Buffer.byteLength(payload),size=fs.existsSync(this.file)?fs.statSync(this.file).size:0;
      // Fail closed on a small/full client disk. Archives always have finite caps.
      if(!this.freeSpaceOK())throw fail('activity_log_low_disk_space',507);
      if(size+bytes>this.config().fileBytes)this.rotate();
      // Oversized batches are not persisted; memory view remains bounded.
      if(bytes>this.config().fileBytes)throw fail('activity_log_batch_too_large',507);
      fs.appendFileSync(this.file,payload,{encoding:'utf8',mode:0o600,flag:'a'});
      this.lastError=null;
    }catch(e){this.lastError=String(e.code||e.message||'activity_log_write_failed').slice(0,120);}
  }
  setPreset(preset){
    if(typeof preset!=='string'||!Object.hasOwn(ACTIVITY_LOG_PRESETS,preset))throw fail('activity_log_preset_invalid');
    this.flush();
    const before=this.settings.preset;this.settings.preset=preset;
    try{
      saveSettings(this.root,this.settings);
      // Reduce the number of retained archives immediately on downgrade.
      for(let i=this.config().archives+1;i<=5;i++)fs.rmSync(this.file+'.'+i+'.gz',{force:true});
      if(fs.existsSync(this.file)&&fs.statSync(this.file).size>this.config().fileBytes)this.rotate();
      return this.stat();
    }catch(e){this.settings.preset=before;throw e;}
  }
  clean(){
    if(this.flushTimer){clearTimeout(this.flushTimer);this.flushTimer=null;}
    this.pending=[];this.pendingBytes=0;
    // Tombstone timestamp prevents last 500 remote events being silently reimported.
    this.settings.purgedBefore=this.now();
    saveSettings(this.root,this.settings);
    for(const file of this.files()){strictFile(file);fs.rmSync(file,{force:true});}
    this.ring=[];this.keys.clear();this.ringBytes=0;this.lastError=null;
    return this.stat();
  }
  close(){this.flush();}
}
