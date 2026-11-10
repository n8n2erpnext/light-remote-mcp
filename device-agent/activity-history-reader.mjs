// Page the complete retained JSONL/gzip history, independent of the RAM ring.
// Cursor identifies an event, never a caller-selected file path or byte offset.
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import crypto from 'node:crypto';
const MAX_LINE=128*1024,MAX_ARCHIVE=51*1024*1024,MAX_PAGE_BYTES=1024*1024;
const fail=(code,status=400)=>Object.assign(Error(code),{status});
export function activityCursor(e){return crypto.createHash('sha256').update(JSON.stringify([e?.id??null,e?.at??null,e?.jobId??null,e?.type??null])).digest('hex');}
export const withActivityCursor=e=>({...e,wallCursor:activityCursor(e)});
function parse(line){
 if(!line||Buffer.byteLength(line)>MAX_LINE)return null;
 try{const e=JSON.parse(line);return e&&typeof e==='object'&&typeof e.type==='string'&&typeof e.at==='string'?e:null;}catch{return null;}
}
async function* reversePlain(file){
 const fd=await fs.promises.open(file,'r');
 try{
  const stat=await fd.stat();let end=stat.size,carry=Buffer.alloc(0),discard=false;
  while(end>0){
   const size=Math.min(65536,end);end-=size;const chunk=Buffer.alloc(size);
   const {bytesRead}=await fd.read(chunk,0,size,end);const block=Buffer.concat([chunk.subarray(0,bytesRead),carry]);
   let tail=block.length;
   for(let i=block.length-1;i>=0;i--)if(block[i]===10){
    if(!discard){const e=parse(block.subarray(i+1,tail).toString('utf8'));if(e)yield e;}
    discard=false;tail=i;
   }
   carry=block.subarray(0,tail);
   if(carry.length>MAX_LINE){carry=Buffer.alloc(0);discard=true;}
  }
  if(!discard){const e=parse(carry.toString('utf8'));if(e)yield e;}
 }finally{await fd.close();}
}
async function archiveBefore(file,anchor,limit){
 const source=fs.createReadStream(file),inflate=zlib.createGunzip();let decoded=0;
 inflate.on('data',data=>{decoded+=data.length;if(decoded>MAX_ARCHIVE)inflate.destroy(fail('activity_history_archive_too_large',503));});
 source.on('error',e=>inflate.destroy(e));source.pipe(inflate);
 const lines=readline.createInterface({input:inflate,crlfDelay:Infinity}),recent=[];
 let found=!anchor,recentBytes=0;
 try{
  for await(const line of lines){
   const e=parse(line);if(!e)continue;
   if(anchor&&activityCursor(e)===anchor){found=true;break;}
   recent.push(e);recentBytes+=Buffer.byteLength(JSON.stringify(e));
   while(recent.length>limit||recentBytes>MAX_PAGE_BYTES*2&&recent.length>1)recentBytes-=Buffer.byteLength(JSON.stringify(recent.shift()));
  }
 }finally{lines.close();source.destroy();inflate.destroy();}
 return {found,events:found?recent.reverse():[]};
}
export async function readActivityHistoryPage({files,before=null,limit=500,purgedBefore=0}={}){
 if(before!==null&&!/^[a-f0-9]{64}$/.test(before))throw fail('activity_history_cursor_invalid');
 const max=Math.max(1,Math.min(Number(limit)||500,1000)),events=[],seen=new Set();let seeking=before,returnedBytes=0,hasMore=false;
 const add=e=>{
  if(Date.parse(e.at)<=purgedBefore)return true;
  const cursor=activityCursor(e);if(seen.has(cursor))return true;
  const row=withActivityCursor(e),bytes=Buffer.byteLength(JSON.stringify(row));
  if(events.length>=max||returnedBytes+bytes>MAX_PAGE_BYTES&&events.length){hasMore=true;return false;}
  seen.add(cursor);events.push(row);returnedBytes+=bytes;return true;
 };
 for(const file of files){
  let stat;try{stat=await fs.promises.lstat(file);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(!stat.isFile()||stat.isSymbolicLink())throw fail('activity_log_path_unsafe',503);
  if(file.endsWith('.gz')){
   const result=await archiveBefore(file,seeking,max+1-events.length);
   if(result.found){seeking=null;for(const e of result.events)if(!add(e))break;}
  }else{
   for await(const e of reversePlain(file)){
    if(seeking){if(activityCursor(e)===seeking)seeking=null;continue;}
    if(!add(e))break;
   }
  }
  if(hasMore)break;
 }
 if(seeking)throw fail('activity_history_cursor_expired',410);
 const rows=events,nextCursor=hasMore?rows.at(-1)?.wallCursor??null:null;
 return {events:rows.reverse(),nextCursor,hasMore,
  returnedBytes,coverage:'retained_device_local_history',pageSize:max,retention:'device_activity_log_preset'};
}
