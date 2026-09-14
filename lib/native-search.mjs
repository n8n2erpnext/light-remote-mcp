import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export class NativeSearchError extends Error {
  constructor(message,status=400){super(message);this.name='NativeSearchError';this.status=status;}
}

const MAX_RESULTS=1000;
const MAX_FILE_BYTES=8*1024*1024;
const MAX_SCANNED_FILES=100000;
const SEARCH_TTL_MS=30*60*1000;
const MAX_SEARCH_MS=5*60*1000;
const validOwner=value=>/^[A-Za-z0-9._:-]{1,180}$/.test(String(value||''));
const validHandle=value=>/^ls_[A-Za-z0-9_-]{20,80}$/.test(String(value||''));
const inside=(root,target)=>{const rel=path.relative(root,target);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
const escRe=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function wildcardRegex(value){
  const source=String(value||'').trim();
  if(!source)return null;
  const parts=source.split('|').map(v=>v.trim()).filter(Boolean);
  if(!parts.length)return null;
  const patterns=parts.map(part=>'^'+escRe(part).replace(/\\\*\\\*/g,'.*').replace(/\\\*/g,'[^/]*').replace(/\\\?/g,'.')+'$');
  return new RegExp(patterns.join('|'),'i');
}
function matcher(pattern,{literal=false,ignoreCase=true}={}){
  const text=String(pattern||'');
  if(!text)throw new NativeSearchError('search_pattern_required');
  if(literal){const needle=ignoreCase?text.toLowerCase():text;return value=>(ignoreCase?String(value).toLowerCase():String(value)).includes(needle);}
  let re;try{re=new RegExp(text,ignoreCase?'i':'');}catch{throw new NativeSearchError('invalid_search_regex');}
  return value=>re.test(String(value));
}
async function resolveRoot(raw,readRoots){
  if(!path.isAbsolute(String(raw||'')))throw new NativeSearchError('search_path_must_be_absolute');
  let target;try{target=await fsp.realpath(raw);}catch(error){if(error?.code==='ENOENT')throw new NativeSearchError('search_path_not_found',404);throw error;}
  const stat=await fsp.stat(target);if(!stat.isDirectory())throw new NativeSearchError('search_path_not_directory',409);
  for(const rootRaw of readRoots||[]){let root;try{root=await fsp.realpath(rootRaw);}catch{root=path.resolve(rootRaw);}if(inside(root,target))return target;}
  throw new NativeSearchError('search_path_outside_allowed_roots',403);
}
export class NativeSearchRegistry {
  constructor({maxSearches=16,now=()=>Date.now(),emit=()=>{}}={}){this.maxSearches=Math.max(1,Math.min(Number(maxSearches)||16,64));this.now=now;this.emit=emit;this.rows=new Map();}
  _id(){return `ls_${crypto.randomBytes(18).toString('base64url')}`;}
  _owner(input){const accountId=String(input.accountId||''),deviceId=String(input.deviceId||''),sessionId=String(input.sessionId||''),agentId=String(input.agentId||'');if(![accountId,deviceId,sessionId,agentId].every(validOwner))throw new NativeSearchError('invalid_search_owner');return {accountId,deviceId,sessionId,agentId};}
  _row(searchId,owner){if(!validHandle(searchId))throw new NativeSearchError('invalid_search_id');const row=this.rows.get(String(searchId));if(!row)throw new NativeSearchError('search_not_found',404);if(owner)for(const key of ['accountId','deviceId','sessionId','agentId'])if(String(owner[key]||'')!==row[key])throw new NativeSearchError('search_owner_mismatch',403);return row;}
  prune(){const now=this.now();for(const [id,row] of this.rows)if(row.finishedAt&&now-row.finishedAt>SEARCH_TTL_MS)this.rows.delete(id);}
  async start({accountId,deviceId,sessionId,agentId,path:rootPath,searchType='content',pattern,literalSearch=false,ignoreCase=true,filePattern='',contextLines=0,maxResults=200,readRoots=[]}){
    this.prune();const owner=this._owner({accountId,deviceId,sessionId,agentId});const active=[...this.rows.values()].filter(x=>!x.finishedAt).length;if(active>=this.maxSearches)throw new NativeSearchError('search_capacity_reached',429);
    const root=await resolveRoot(rootPath,readRoots),searchId=this._id(),startedAt=this.now();
    const row={searchId,...owner,path:root,searchType:searchType==='files'?'files':'content',pattern:String(pattern||''),literalSearch:Boolean(literalSearch),ignoreCase:ignoreCase!==false,filePattern:String(filePattern||''),contextLines:Math.max(0,Math.min(Number(contextLines)||0,20)),maxResults:Math.max(1,Math.min(Number(maxResults)||200,MAX_RESULTS)),state:'running',startedAt,firstResultAt:null,finishedAt:null,cancelledAt:null,error:null,scannedFiles:0,scannedDirs:0,results:[],cancelRequested:false};
    this.rows.set(searchId,row);this.emit({type:'search_started',...owner,searchId,searchType:row.searchType,path:root,startedAt});
    queueMicrotask(()=>this._run(row).catch(error=>this._finish(row,'error',String(error?.message||error))));
    return this.view(searchId,owner);
  }
  _finish(row,state,error=null){
    if(row.finishedAt)return;row.state=state;row.error=error;row.finishedAt=this.now();if(state==='cancelled')row.cancelledAt=row.finishedAt;
    this.emit({type:'search_finished',accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,searchId:row.searchId,state:row.state,resultCount:row.results.length,scannedFiles:row.scannedFiles,durationMs:row.finishedAt-row.startedAt,error:error||null});
  }
  _push(row,result){if(row.results.length>=row.maxResults)return false;if(!row.firstResultAt)row.firstResultAt=this.now();row.results.push(result);if(row.results.length>=row.maxResults)return false;return true;}
  async _run(row){
    const matches=matcher(row.pattern,{literal:row.literalSearch,ignoreCase:row.ignoreCase}),fileFilter=wildcardRegex(row.filePattern),stack=[row.path],deadline=row.startedAt+MAX_SEARCH_MS;
    while(stack.length){
      if(row.cancelRequested)return this._finish(row,'cancelled');if(this.now()>deadline)return this._finish(row,'timeout','search_timeout');
      const dir=stack.pop();row.scannedDirs++;let entries;try{entries=await fsp.readdir(dir,{withFileTypes:true});}catch{continue;}
      for(const entry of entries){
        if(row.cancelRequested)return this._finish(row,'cancelled');
        const full=path.join(dir,entry.name),rel=path.relative(row.path,full).split(path.sep).join('/');
        if(entry.isSymbolicLink())continue;if(entry.isDirectory()){stack.push(full);continue;}if(!entry.isFile())continue;
        row.scannedFiles++;if(row.scannedFiles>MAX_SCANNED_FILES)return this._finish(row,'limit','search_scan_limit_reached');
        if(fileFilter&&!fileFilter.test(rel)&&!fileFilter.test(entry.name))continue;
        if(row.searchType==='files'){
          if(matches(rel)||matches(entry.name))if(!this._push(row,{type:'file',path:full,relativePath:rel,name:entry.name}))return this._finish(row,'finished');
        }else await this._scanContent(row,full,rel,matches);
        if(row.results.length>=row.maxResults)return this._finish(row,'finished');
        if((row.scannedFiles%100)===0)await new Promise(resolve=>setImmediate(resolve));
      }
    }
    this._finish(row,'finished');
  }
  async _scanContent(row,full,rel,matches){
    let stat;try{stat=await fsp.stat(full);}catch{return;}if(stat.size>MAX_FILE_BYTES)return;
    let raw;try{raw=await fsp.readFile(full);}catch{return;}if(raw.includes(0))return;
    const lines=raw.toString('utf8').split(/\r?\n/);
    for(let i=0;i<lines.length;i++){
      if(row.cancelRequested||row.results.length>=row.maxResults)return;
      if(!matches(lines[i]))continue;
      const from=Math.max(0,i-row.contextLines),to=Math.min(lines.length,i+row.contextLines+1);
      this._push(row,{type:'content',path:full,relativePath:rel,lineNumber:i+1,line:lines[i],before:lines.slice(from,i),after:lines.slice(i+1,to)});
    }
  }
  results(searchId,owner,{offset=0,limit=100}={}){
    const row=this._row(searchId,owner),start=Math.max(0,Number(offset)||0),max=Math.max(1,Math.min(Number(limit)||100,500)),items=row.results.slice(start,start+max);
    return {...this.view(searchId,owner),offset:start,returned:items.length,nextOffset:start+items.length,hasMore:start+items.length<row.results.length||!row.finishedAt,results:items};
  }
  cancel(searchId,owner){const row=this._row(searchId,owner);if(row.finishedAt)return this.view(searchId,owner);row.cancelRequested=true;return this.view(searchId,owner);}
  view(searchId,owner=null){const row=this._row(searchId,owner);return {searchId:row.searchId,accountId:row.accountId,deviceId:row.deviceId,sessionId:row.sessionId,agentId:row.agentId,path:row.path,searchType:row.searchType,state:row.state,startedAt:row.startedAt,firstResultAt:row.firstResultAt,finishedAt:row.finishedAt,cancelledAt:row.cancelledAt,error:row.error,scannedFiles:row.scannedFiles,scannedDirs:row.scannedDirs,resultCount:row.results.length,maxResults:row.maxResults};}
}
