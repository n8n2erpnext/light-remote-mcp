import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DeviceLocalActivityLog} from './local-activity-log.mjs';
test('every retained event remains pageable beyond200, across gzip rotation, restart and RAM expiry',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-history-pages-')),now=Date.now();let log;
 t.after(()=>{log?.close();fs.rmSync(root,{recursive:true,force:true});});
 log=new DeviceLocalActivityLog({root,deviceId:'fixture-device',now:()=>now});
 for(let i=1;i<=1800;i++){
  log.add({id:'event-'+i,type:'job_finished',jobId:'job-'+i,at:new Date(now-(1801-i)*10).toISOString(),status:'ok',script:i%101===0?'echo '+('đa '.repeat(7000)):'echo fixture-'+i});
  if(i===600||i===1200){log.flush();log.rotate();}
 }
 log.close();log=new DeviceLocalActivityLog({root,deviceId:'fixture-device',now:()=>now+7200000});
 assert.equal(log.recent(5000).length,0,'RAM one-hour window is deliberately empty');
 let before=null,ids=[],pages=0;
 do{
  const p=await log.historyPage({before,limit:173});assert.ok(p.events.length<=173);ids.push(...p.events.map(e=>e.id));before=p.nextCursor;pages++;
  if(pages===1){log.rotate();log.add({id:'new-event',type:'job_finished',jobId:'new-job',at:new Date(now+7200000).toISOString(),status:'ok'});log.flush();}
 }while(before);
 assert.ok(pages>10);assert.equal(ids.length,1800);assert.equal(new Set(ids).size,1800);assert.ok(ids.includes('event-1')&&ids.includes('event-1800'));
 const newest=await log.historyPage({limit:100000});assert.equal(newest.events.length,1000);assert.equal(newest.events.at(-1).id,'new-event');assert.equal(newest.hasMore,true);
 await assert.rejects(log.historyPage({before:'../../secret'}),/cursor_invalid/);
 await assert.rejects(log.historyPage({before:'0'.repeat(64)}),/cursor_expired/);
 log.clean();const empty=await log.historyPage();assert.equal(empty.events.length,0);assert.equal(empty.nextCursor,null);
});
