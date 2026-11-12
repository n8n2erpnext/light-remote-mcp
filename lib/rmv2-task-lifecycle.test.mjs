import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RM_TASK_IDLE_MS,requireOwnedRmTask,rmTaskMayExpire,withRmTask,closeRmTask,rememberRmTaskClose,confirmedRmTaskClose} from './rmv2-task-lifecycle.mjs';
const owner={sessionId:'session-a',agentId:'agent-a'};
const fixture=()=>{const row={...owner,desktopSessionId:'desk_scope123',expiresAt:RM_TASK_IDLE_MS,inFlight:0,closing:false};return {row,rows:new Map([[row.desktopSessionId,row]])};};
test('input requires a live scope owned by the exact A/B session and Agent',()=>{
  const {rows,row}=fixture();
  assert.equal(requireOwnedRmTask(rows,owner,'',{now:0}),row);
  assert.throws(()=>requireOwnedRmTask(rows,{...owner,agentId:'other'},row.desktopSessionId,{now:0}),/owner_mismatch/);
  assert.throws(()=>requireOwnedRmTask(rows,{...owner,sessionId:'other'},row.desktopSessionId,{now:0}),/owner_mismatch/);
  rows.clear();assert.throws(()=>requireOwnedRmTask(rows,owner,'',{now:0}),/required_call_desktop_attach/);
});
test('quiet scope expires exactly at45s; reading status alone does not renew it',()=>{
  const {row}=fixture();assert.equal(rmTaskMayExpire(row,44999),false);
  assert.equal(rmTaskMayExpire(row,45000),true);assert.equal(row.expiresAt,45000);
});
test('a long running input/frame stays live then gets45s after completion',async()=>{
  const {row,rows}=fixture();let now=0,complete;
  const arm=r=>r.expiresAt=now+RM_TASK_IDLE_MS;
  const op=withRmTask(rows,row,()=>new Promise(resolve=>{complete=resolve;}),arm);
  await Promise.resolve();
  now=90000;assert.equal(rmTaskMayExpire(row,now),false);
  assert.equal(requireOwnedRmTask(rows,owner,'',{now}),row);
  complete({desktop:{applied:true}});const out=await op;
  assert.equal(row.expiresAt,135000);assert.equal(out.rmTask.closeBeforeFinalReport,true);
});
test('continuous design captures renew the scope without reopening it',async()=>{
  const {row,rows}=fixture();let now=0;
  for(let i=0;i<20;i++){
    now+=30000;await withRmTask(rows,row,async()=>({frame:i}),r=>r.expiresAt=now+RM_TASK_IDLE_MS);
    assert.equal(rmTaskMayExpire(row,now+30000),false);
  }
  assert.equal(rows.size,1);
});
test('late result after close cannot resurrect scope; reopen needs a new ID',async()=>{
  const {row,rows}=fixture();let resolve,armed=0;
  const pending=withRmTask(rows,row,()=>new Promise(r=>{resolve=r;}),()=>armed++);
  await Promise.resolve();
  const closing=closeRmTask(rows,row,{detach:async()=>({detached:true,indicatorStopped:true}),release:()=>{},closeIdle:()=>{}});
  assert.equal(row.closing,true);resolve({desktop:{applied:true}});await pending;
  const closed=await closing;assert.equal(closed.newAttachRequired,true);
  assert.equal(armed,1);assert.equal(rows.size,0);
  assert.throws(()=>requireOwnedRmTask(rows,owner,row.desktopSessionId,{now:0}),/closed_call_desktop_attach/);
});
test('failed cleanup remains closed to input and can be retried explicitly',async()=>{
  const {row,rows}=fixture();let released=0;
  await assert.rejects(closeRmTask(rows,row,{detach:async()=>{throw Error('rpc_failed');},release:()=>released++,closeIdle:()=>{}}),/rpc_failed/);
  assert.equal(rows.size,1);assert.equal(released,0);
  assert.throws(()=>requireOwnedRmTask(rows,owner,row.desktopSessionId,{now:0}),/closing/);
  assert.equal(requireOwnedRmTask(rows,owner,row.desktopSessionId,{closing:true}),row);
  await closeRmTask(rows,row,{detach:async()=>({scopeClosed:true}),release:()=>released++,closeIdle:()=>{}});
  assert.equal(rows.size,0);assert.equal(released,1);
});
test('ambiguous scopes cannot silently select another task',()=>{
  const {row,rows}=fixture();rows.set('desk_second',{...row,desktopSessionId:'desk_second'});
  assert.throws(()=>requireOwnedRmTask(rows,owner,'',{now:0}),/multiple_open/);
});
test('confirmed native close stays acknowledged if local reference cleanup fails',async()=>{
  const {row,rows}=fixture();
  const result=await closeRmTask(rows,row,{detach:async()=>({scopeClosed:true,indicatorStopped:true}),release:()=>{throw Error('local_reference_failed');},closeIdle:()=>{}});
  assert.equal(result.taskEnded,true);assert.equal(result.resourceCleanupWarning,true);assert.equal(rows.size,0);
});
test('automatic close can be acknowledged later only to its original owner',async()=>{
  const {row,rows}=fixture(),closed=new Map();
  const receipt=await closeRmTask(rows,row,{detach:async()=>({scopeClosed:true,indicatorStopped:true}),release:()=>{},closeIdle:()=>{}});
  rememberRmTaskClose(closed,row,receipt,45000);
  assert.equal(confirmedRmTaskClose(closed,owner,row.desktopSessionId,50000).alreadyClosed,true);
  assert.throws(()=>confirmedRmTaskClose(closed,{...owner,agentId:'other'},row.desktopSessionId,50000),/owner_mismatch/);
  assert.throws(()=>requireOwnedRmTask(rows,owner,row.desktopSessionId,{now:50000}),/closed_call_desktop_attach/);
  assert.equal(confirmedRmTaskClose(closed,owner,row.desktopSessionId,1000000),null);
});
