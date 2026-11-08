/**
 * rc.50 DEV/UAT-ONLY Agent effect inventory.
 * Not integrated with the production Agent, not a global writer fence.
 *
 * The sole safe transition before an OS spawn is a durable intent. Even an
 * observed process/PTY exit is kept unresolved until future independent owner
 * reconciliation under authenticated writer authority.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {durableAtomicWriteSync} from '../../lib/durable-atomic-file.mjs';

const ID=/^[A-Za-z0-9._:-]{1,128}$/;
const BOOT=/^[A-Za-z0-9_-]{32,128}$/;
const MAX_ROWS=512;
const OWNER=['accountId','deviceId','sessionId','agentId'];
const ROW_KEYS=['accountId','agentId','armedAt','bootId','commandId','deviceId',
  'effectId','exitAt','handleId','kind','nodeId','osPid','sessionId',
  'spawnedAt','stage','writerGeneration'];
const TIME=v=>Number.isSafeInteger(v)&&v>0;
const validId=(v,key)=>{if(typeof v!=='string'||!ID.test(v))throw Error('DEV_EFFECT_INVENTORY_INVALID_'+key);return v;};
function validateRow(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).sort().join(',')!==ROW_KEYS.join(','))
    throw Error('DEV_EFFECT_INVENTORY_INVALID_ROW');
  const x={};
  for(const key of ROW_KEYS)x[key]=input[key];
  for(const key of [...OWNER,'commandId','nodeId','effectId'])validId(x[key],key);
  if(typeof x.bootId!=='string'||!BOOT.test(x.bootId))
    throw Error('DEV_EFFECT_INVENTORY_BOOT_INVALID');
  if(!Number.isSafeInteger(x.writerGeneration)||x.writerGeneration<1)
    throw Error('DEV_EFFECT_INVENTORY_GENERATION_INVALID');
  if(!['process','terminal'].includes(x.kind)||!TIME(x.armedAt))
    throw Error('DEV_EFFECT_INVENTORY_INTENT_INVALID');
  if(!['intent','spawned','exited'].includes(x.stage))
    throw Error('DEV_EFFECT_INVENTORY_STAGE_INVALID');
  if(x.stage==='intent'){
    if(x.handleId!==null||x.osPid!==null||x.spawnedAt!==null||x.exitAt!==null)
      throw Error('DEV_EFFECT_INVENTORY_INTENT_MISMATCH');
  }else{
    const prefix=x.kind==='process'?'lp_':'ltm_';
    if(typeof x.handleId!=='string'||!x.handleId.startsWith(prefix)||
       !/^[A-Za-z0-9_-]{24,84}$/.test(x.handleId)||
       !Number.isSafeInteger(x.osPid)||x.osPid<=0||!TIME(x.spawnedAt)||
       x.spawnedAt<x.armedAt)
      throw Error('DEV_EFFECT_INVENTORY_SPAWN_INVALID');
    if(x.stage==='spawned'&&x.exitAt!==null)
      throw Error('DEV_EFFECT_INVENTORY_SPAWN_MISMATCH');
    if(x.stage==='exited'&&(!TIME(x.exitAt)||x.exitAt<x.spawnedAt))
      throw Error('DEV_EFFECT_INVENTORY_EXIT_INVALID');
  }
  return x;
}
function load(file){
  if(typeof file!=='string'||!path.isAbsolute(file))
    throw Error('DEV_EFFECT_INVENTORY_PATH_REQUIRED');
  const parent=fs.lstatSync(path.dirname(file));
  if(!parent.isDirectory()||parent.isSymbolicLink()||
     (parent.mode&0o022)!==0)throw Error('DEV_EFFECT_INVENTORY_UNTRUSTED_PARENT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let contents;
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.nlink!==1||(stat.mode&0o777)!==0o600||
       stat.size>2*1024*1024)throw Error('DEV_EFFECT_INVENTORY_UNTRUSTED_FILE');
    contents=fs.readFileSync(fd,'utf8');
  }finally{fs.closeSync(fd);}
  let parsed;
  try{parsed=JSON.parse(contents);}catch{throw Error('DEV_EFFECT_INVENTORY_INVALID_JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
     Object.keys(parsed).sort().join(',')!=='entries,schemaVersion'||
     parsed.schemaVersion!==1||!Array.isArray(parsed.entries)||
     parsed.entries.length>MAX_ROWS)throw Error('DEV_EFFECT_INVENTORY_INVALID_FORMAT');
  const rows=parsed.entries.map(validateRow);
  if(new Set(rows.map(x=>x.effectId)).size!==rows.length)
    throw Error('DEV_EFFECT_INVENTORY_DUPLICATE');
  return rows;
}
export function inspectDevAgentEffectInventory({file}={}){
  const rows=load(file);
  // A lock indicates a currently held or crashed owner; never infer stale.
  const ownerLockPresent=fs.existsSync(file+'.owner.lock');
  return {entries:rows.map(x=>({...x})),ownerLockPresent,
    blocked:ownerLockPresent||rows.length>0,
    unresolved:rows.length,
    counts:{intent:rows.filter(x=>x.stage==='intent').length,
      spawned:rows.filter(x=>x.stage==='spawned').length,
      exited:rows.filter(x=>x.stage==='exited').length},
    settlementAuthorized:false};
}
export class DevAgentEffectInventory{
  constructor({file,write=durableAtomicWriteSync}={}){
    if(typeof write!=='function')throw Error('DEV_EFFECT_INVENTORY_WRITER_REQUIRED');
    const rows=load(file);
    if(rows.length)throw Error('DEV_EFFECT_INVENTORY_UNRESOLVED_STARTUP_REFUSED');
    this.file=file;this.write=write;
    this.lockPath=file+'.owner.lock';
    this.lockFd=fs.openSync(this.lockPath,fs.constants.O_CREAT|
      fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
    try{
      fs.writeSync(this.lockFd,crypto.randomBytes(24).toString('hex')+'\n');
      fs.fsyncSync(this.lockFd);
      const dirFd=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|
        fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
      try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
    }catch(error){fs.closeSync(this.lockFd);throw error;}
    this.rows=new Map();this.closed=false;this.poisoned=false;
  }
  get unresolved(){return this.rows.size;}
  _owner(){
    if(this.closed||this.poisoned)throw Error('DEV_EFFECT_INVENTORY_NOT_WRITABLE');
    let a,b;
    try{a=fs.fstatSync(this.lockFd);b=fs.lstatSync(this.lockPath);}
    catch{this.poisoned=true;throw Error('DEV_EFFECT_INVENTORY_OWNER_LOST');}
    if(!b.isFile()||b.nlink!==1||b.isSymbolicLink()||
       (b.mode&0o777)!==0o600||a.dev!==b.dev||a.ino!==b.ino){
      this.poisoned=true;throw Error('DEV_EFFECT_INVENTORY_OWNER_LOST');
    }
  }
  _persist(next){
    this._owner();
    try{
      const acknowledged=this.write(this.file,
        JSON.stringify({schemaVersion:1,entries:[...next.values()]})+'\n',
        {mode:0o600});
      if(acknowledged!==true)throw Error('DEV_EFFECT_INVENTORY_DURABILITY_UNCONFIRMED');
    }catch(e){this.poisoned=true;throw e;}
    this.rows=next;
  }
  arm({effectId,commandId,owner,nodeId,kind,writerGeneration,bootId,armedAt=Date.now()}={}){
    const row=validateRow({...owner,effectId,commandId,nodeId,kind,
      writerGeneration,bootId,armedAt,handleId:null,osPid:null,
      spawnedAt:null,exitAt:null,stage:'intent'});
    if(this.rows.has(effectId))throw Error('DEV_EFFECT_INVENTORY_DUPLICATE');
    if(this.rows.size>=MAX_ROWS)throw Error('DEV_EFFECT_INVENTORY_FULL');
    const next=new Map(this.rows);next.set(effectId,row);this._persist(next);
    return {...row};
  }
  _known(effectId){
    validId(effectId,'effectId');
    const row=this.rows.get(effectId);
    if(!row)throw Error('DEV_EFFECT_INVENTORY_UNKNOWN_EFFECT');
    return row;
  }
  recordSpawn(effectId,{registry,handleId,now=Date.now()}={}){
    const prior=this._known(effectId);
    if(prior.stage!=='intent')throw Error('DEV_EFFECT_INVENTORY_WRONG_STAGE');
    const view=this._census(prior,registry,handleId);
    if(view.startedAt<prior.armedAt||view.startedAt>now||
       !Number.isSafeInteger(view.pid)||view.pid<=0)
      throw Error('DEV_EFFECT_INVENTORY_CENSUS_INVALID');
    const next=new Map(this.rows);
    const row=validateRow({...prior,stage:'spawned',handleId,osPid:view.pid,
      spawnedAt:view.startedAt});
    next.set(effectId,row);this._persist(next);
    return {...row};
  }
  _census(row,registry,handleId){
    if(!registry||typeof registry.list!=='function')
      throw Error('DEV_EFFECT_INVENTORY_CENSUS_MISSING');
    const owner=Object.fromEntries(OWNER.map(k=>[k,row[k]]));
    const entries=registry.list(owner);
    if(!Array.isArray(entries))throw Error('DEV_EFFECT_INVENTORY_CENSUS_INVALID');
    const idKey=row.kind==='process'?'processId':'terminalId';
    const matched=entries.filter(v=>v?.[idKey]===handleId);
    if(matched.length!==1)throw Error('DEV_EFFECT_INVENTORY_HANDLE_UNOBSERVED');
    const item=matched[0];
    for(const [key,val] of Object.entries(owner))
      if(item[key]!==val)throw Error('DEV_EFFECT_INVENTORY_OWNER_MISMATCH');
    if(!TIME(item.startedAt)||item.finishedAt!==null&&
       (!TIME(item.finishedAt)||item.finishedAt<item.startedAt))
      throw Error('DEV_EFFECT_INVENTORY_CENSUS_INVALID');
    return item;
  }
  recordExit(effectId,{registry,now=Date.now()}={}){
    const prior=this._known(effectId);
    if(prior.stage!=='spawned')throw Error('DEV_EFFECT_INVENTORY_WRONG_STAGE');
    const item=this._census(prior,registry,prior.handleId);
    if(item.pid!==prior.osPid||item.startedAt!==prior.spawnedAt||
       !TIME(item.finishedAt)||item.finishedAt>now)
      throw Error('DEV_EFFECT_INVENTORY_NOT_PROVEN_EXITED');
    const next=new Map(this.rows);
    const row=validateRow({...prior,stage:'exited',exitAt:item.finishedAt});
    next.set(effectId,row);this._persist(next);
    // Still unresolved: only observation, NOT global side-effect quiescence.
    return {entry:{...row},verdict:'EXIT_OBSERVED_UNFENCED',
      settlementAuthorized:false};
  }
  releaseClean(){
    if(this.rows.size)throw Error('DEV_EFFECT_INVENTORY_RELEASE_PENDING');
    this._owner();
    fs.unlinkSync(this.lockPath);
    const dirFd=fs.openSync(path.dirname(this.file),fs.constants.O_RDONLY|
      fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{fs.fsyncSync(dirFd);}finally{fs.closeSync(dirFd);}
    fs.closeSync(this.lockFd);this.closed=true;
    return true;
  }
}
