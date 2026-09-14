import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export class NativeFsError extends Error {
  constructor(message,status=400){super(message);this.name='NativeFsError';this.status=status;}
}

const MAX_TEXT_BYTES=4*1024*1024;
const MAX_WRITE_BYTES=8*1024*1024;
const MAX_ENTRIES=1000;
const splitRoots=value=>String(value||'').split(';').map(v=>v.trim()).filter(Boolean);
const canonical=p=>path.resolve(String(p||''));
const inside=(root,target)=>{const rel=path.relative(root,target);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};

export function filesystemPolicy(env=process.env){
  const defaults=[os.homedir(),os.tmpdir()].map(canonical);
  const read=splitRoots(env.LIGHT_REMOTE_FS_READ_ROOTS); const write=splitRoots(env.LIGHT_REMOTE_FS_WRITE_ROOTS);
  const readRoots=(read.length?read:defaults).map(canonical),writeRoots=(write.length?write:defaults).map(canonical);
  const upload=splitRoots(env.LIGHT_REMOTE_FS_UPLOAD_ROOTS),download=splitRoots(env.LIGHT_REMOTE_FS_DOWNLOAD_ROOTS);
  return {readRoots,writeRoots,uploadRoots:(upload.length?upload:writeRoots).map(canonical),downloadRoots:(download.length?download:readRoots).map(canonical)};
}

async function realRoot(root){try{return await fsp.realpath(root);}catch{return canonical(root);}}
async function assertExisting(raw,roots){
  if(!path.isAbsolute(String(raw||'')))throw new NativeFsError('filesystem_path_must_be_absolute');
  let target;try{target=await fsp.realpath(raw);}catch(error){if(error?.code==='ENOENT')throw new NativeFsError('filesystem_path_not_found',404);throw error;}
  for(const root of roots){if(inside(await realRoot(root),target))return target;}
  throw new NativeFsError('filesystem_path_outside_allowed_roots',403);
}
async function assertWritable(raw,roots){
  if(!path.isAbsolute(String(raw||'')))throw new NativeFsError('filesystem_path_must_be_absolute');
  const target=canonical(raw);let probe=target;
  while(!fs.existsSync(probe)){const parent=path.dirname(probe);if(parent===probe)break;probe=parent;}
  let realProbe;try{realProbe=await fsp.realpath(probe);}catch{realProbe=canonical(probe);}
  const suffix=path.relative(probe,target),resolved=canonical(path.join(realProbe,suffix));
  for(const root of roots){if(inside(await realRoot(root),resolved))return resolved;}
  throw new NativeFsError('filesystem_path_outside_allowed_roots',403);
}

export async function resolveUploadTarget(raw,policy=filesystemPolicy()){return assertWritable(raw,policy.uploadRoots||policy.writeRoots);}
export async function resolveDownloadSource(raw,policy=filesystemPolicy()){return assertExisting(raw,policy.downloadRoots||policy.readRoots);}

function limitText(value,max=MAX_TEXT_BYTES){
  const buf=Buffer.from(String(value),'utf8');
  if(buf.length<=max)return {text:buf.toString('utf8'),bytes:buf.length,truncated:false,nextOffset:null};
  return {text:buf.subarray(0,max).toString('utf8'),bytes:buf.length,truncated:true,nextOffset:max};
}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function normalizeText(buffer){
  if(buffer.includes(0))throw new NativeFsError('filesystem_binary_file_not_supported',415);
  return buffer.toString('utf8');
}
function statView(p,st){return {path:p,type:st.isDirectory()?'directory':st.isFile()?'file':st.isSymbolicLink()?'symlink':'other',size:st.size,mode:(st.mode&0o7777).toString(8),mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs};}

async function readText(input,policy){
  const p=await assertExisting(input.path,policy.readRoots),st=await fsp.stat(p);
  if(!st.isFile())throw new NativeFsError('filesystem_not_a_file',409);
  const maxBytes=Math.max(1,Math.min(Number(input.maxBytes)||MAX_TEXT_BYTES,MAX_TEXT_BYTES));
  const raw=await fsp.readFile(p); const text=normalizeText(raw);
  if(input.tailLines){const n=Math.max(1,Math.min(Number(input.tailLines),5000));const lines=text.split(/\r?\n/);const selected=lines.slice(-n).join('\n');return {ok:true,operation:'read',...statView(p,st),sha256:sha(raw),...limitText(selected,maxBytes)};}
  const start=Math.max(1,Number(input.startLine)||1), count=Math.max(1,Math.min(Number(input.maxLines)||400,5000));
  const selected=text.split(/\r?\n/).slice(start-1,start-1+count).join('\n');
  return {ok:true,operation:'read',...statView(p,st),sha256:sha(raw),startLine:start,maxLines:count,...limitText(selected,maxBytes)};
}
async function writeText(input,policy){
  const p=await assertWritable(input.path,policy.writeRoots),content=String(input.content??'');
  const bytes=Buffer.byteLength(content);if(bytes>MAX_WRITE_BYTES)throw new NativeFsError('filesystem_write_too_large',413);
  const parent=path.dirname(p);
  if(input.createParents)await fsp.mkdir(parent,{recursive:true});
  else { const parentStat=await fsp.stat(parent).catch(()=>null); if(!parentStat?.isDirectory())throw new NativeFsError('filesystem_parent_not_found',404); }
  if(input.mode==='append')await fsp.appendFile(p,content,'utf8');
  else if(input.atomic!==false){const tmp=path.join(path.dirname(p),`.lr-${path.basename(p)}-${crypto.randomUUID()}.tmp`);await fsp.writeFile(tmp,content,'utf8');await fsp.rename(tmp,p);}
  else await fsp.writeFile(p,content,'utf8');
  const st=await fsp.stat(p),raw=await fsp.readFile(p);return {ok:true,operation:'write',...statView(p,st),sha256:sha(raw),writtenBytes:bytes,mode:input.mode==='append'?'append':'rewrite'};
}

async function editBlock(input,policy){
  const p=await assertWritable(input.path,policy.writeRoots);await assertExisting(p,policy.readRoots);
  const raw=await fsp.readFile(p);const text=normalizeText(raw),oldText=String(input.oldText??''),newText=String(input.newText??'');
  if(!oldText)throw new NativeFsError('filesystem_edit_old_text_required');
  const matches=text.split(oldText).length-1,expected=Math.max(1,Number(input.expectedReplacements)||1);
  if(matches!==expected)throw new NativeFsError(`filesystem_edit_match_count:${matches}`,409);
  const next=text.split(oldText).join(newText),tmp=path.join(path.dirname(p),`.lr-${path.basename(p)}-${crypto.randomUUID()}.tmp`);
  await fsp.writeFile(tmp,next,'utf8');await fsp.rename(tmp,p);const st=await fsp.stat(p);return {ok:true,operation:'edit',...statView(p,st),replacements:matches,sha256:sha(Buffer.from(next))};
}

async function statPath(input,policy){const p=await assertExisting(input.path,policy.readRoots);return {ok:true,operation:'stat',...statView(p,await fsp.lstat(p))};}
async function listPath(input,policy){
  const root=await assertExisting(input.path,policy.readRoots),st=await fsp.stat(root);if(!st.isDirectory())throw new NativeFsError('filesystem_not_a_directory',409);
  const max=Math.max(1,Math.min(Number(input.maxEntries)||200,MAX_ENTRIES)),depth=Math.max(0,Math.min(Number(input.maxDepth)||0,3)),rows=[];
  async function walk(dir,d){for(const entry of await fsp.readdir(dir,{withFileTypes:true})){if(rows.length>=max)return;const p=path.join(dir,entry.name),s=await fsp.lstat(p);rows.push({...statView(p,s),name:entry.name,relativePath:path.relative(root,p)});if(entry.isDirectory()&&d<depth)await walk(p,d+1);}}
  await walk(root,0);return {ok:true,operation:'list',path:root,entries:rows,truncated:rows.length>=max,maxEntries:max,maxDepth:depth};
}
async function makeDir(input,policy){const p=await assertWritable(input.path,policy.writeRoots);await fsp.mkdir(p,{recursive:input.parents!==false});return {ok:true,operation:'mkdir',path:p};}
async function copyPath(input,policy){const src=await assertExisting(input.source,policy.readRoots),dst=await assertWritable(input.destination,policy.writeRoots);if(fs.existsSync(dst)&&!input.overwrite)throw new NativeFsError('filesystem_destination_exists',409);await fsp.cp(src,dst,{recursive:true,force:Boolean(input.overwrite),errorOnExist:!input.overwrite});return {ok:true,operation:'copy',source:src,destination:dst};}
async function movePath(input,policy){const src=await assertExisting(input.source,policy.writeRoots),dst=await assertWritable(input.destination,policy.writeRoots);if(fs.existsSync(dst)&&!input.overwrite)throw new NativeFsError('filesystem_destination_exists',409);if(input.overwrite&&fs.existsSync(dst))await fsp.rm(dst,{recursive:true,force:true});await fsp.rename(src,dst);return {ok:true,operation:'move',source:src,destination:dst};}
async function deletePath(input,policy){const p=await assertExisting(input.path,policy.writeRoots),st=await fsp.lstat(p);if(st.isDirectory()&&!input.recursive)throw new NativeFsError('filesystem_recursive_required',409);await fsp.rm(p,{recursive:Boolean(input.recursive),force:false});return {ok:true,operation:'delete',path:p,type:st.isDirectory()?'directory':'file'};}

export async function executeNativeFs(input,{policy=filesystemPolicy()}={}){
  const op=String(input?.op||'');
  if(op==='read')return readText(input,policy);
  if(op==='readMany'){
    const paths=Array.isArray(input.paths)?input.paths:[];if(!paths.length||paths.length>20)throw new NativeFsError('filesystem_read_many_count');
    const files=[];for(const p of paths){try{files.push(await readText({...input,path:p,op:'read',maxBytes:input.maxBytesPerFile},policy));}catch(error){files.push({ok:false,path:p,error:error.message,status:error.status||500});}}return {ok:true,operation:'readMany',files};
  }
  if(op==='write')return writeText(input,policy);
  if(op==='edit')return editBlock(input,policy);
  if(op==='stat')return statPath(input,policy);
  if(op==='list')return listPath(input,policy);
  if(op==='mkdir')return makeDir(input,policy);
  if(op==='copy')return copyPath(input,policy);
  if(op==='move')return movePath(input,policy);
  if(op==='delete')return deletePath(input,policy);
  throw new NativeFsError('filesystem_operation_unsupported');
}
