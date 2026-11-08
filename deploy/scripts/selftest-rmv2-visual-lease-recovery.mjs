import assert from 'node:assert/strict';
import fs from 'node:fs';
import {recoverableVisualFrameError,reacquireNativeVisual} from '../../lib/rmv2-visual-lease-recovery.mjs';
import {NativeDesktopBridge} from '../../lib/native-desktop.mjs';

for(const code of ['visual_session_missing','visual_lease_expired',
  'real_remote_helper_closed','real_remote_helper_exited','real_remote_helper_timeout',
  'real_remote_pipe_closed','real_remote_pipe_unavailable','real_remote_ready_timeout',
  'connect ENOENT \\\\.\\pipe\\lightremote-rmv2-dead']){
  assert.equal(recoverableVisualFrameError(new Error(code)),true,code);
}
for(const code of ['desktop_session_owner_mismatch','desktop_display_topology_changed',
  'visual_lease_invalid','visual_session_limit','desktop_input_denied','real_remote_helper_error']){
  assert.equal(recoverableVisualFrameError(new Error(code)),false,code);
}
{
 const bridge=new NativeDesktopBridge({command:'fake-helper',platform:'linux'});
 const oldRelease=bridge.retain();assert.equal(bridge.retainCount,1);
 bridge.close();assert.equal(bridge.retainCount,0);
 const nextRelease=bridge.retain();assert.equal(bridge.retainCount,1);
 oldRelease();assert.equal(bridge.retainCount,1,'stale generation release cannot close new helper');
 nextRelease();assert.equal(bridge.retainCount,0);
 bridge.close();
}
const makeRow=()=>({
  desktopSessionId:'desk_test',visualSessionId:'vis_old',leaseToken:'vlease_old',
  nativeEpoch:'epoch_old',nativeStale:true,displayTopologyId:'topology_test',
  screen:0,maxWidth:960,maxHeight:540,quality:50,idleTimeoutMs:120000,
  sessionId:'s_test_agent',agentId:'plugin_test',
  lastFrameSha:'abc',expiresAt:Date.now()+120000,stopping:null,recovering:null
});
{
 const row=makeRow(),calls=[];
 let callbackCount=0;
 const result=await reacquireNativeVisual(row,{
  onRecovered:r=>{assert.equal(r,row);callbackCount++;},
  requestNative:async (op,args)=>{
    calls.push({op,args});
    return {visualSessionId:'vis_new',leaseToken:'vlease_new',
      displayTopologyId:'topology_test',epoch:'epoch_new'};
  },isCurrent:r=>r===row
 });
 assert.deepEqual(result,{recovered:true,epochChanged:true});
 assert.equal(row.visualSessionId,'vis_new');assert.equal(row.leaseToken,'vlease_new');
 assert.equal(row.lastFrameSha,null);assert.equal(row.nativeStale,false);
 assert.equal(row.nativeEpoch,'epoch_new');
 assert.equal(callbackCount,1);
 assert.equal(calls[0].op,'visual-attach');
 assert.equal(calls[0].args.owner,'s_test_agent:plugin_test');
 assert.equal(calls[0].args.leaseMs,120000);
 assert.equal(calls[0].args.maxWidth,960);
 assert.equal(result.leaseToken,undefined,'internal native lease never returned');
}
{
 const row=makeRow(),calls=[];
 await assert.rejects(()=>reacquireNativeVisual(row,{
  requestNative:async(op,args)=>{
    calls.push(op);
    if(op==='visual-detach')return {detached:true};
    return {visualSessionId:'vis_untrusted',leaseToken:'vlease_fresh',
      displayTopologyId:'topology_changed',epoch:'epoch_changed'};
  },isCurrent:r=>r===row
 }),/desktop_display_topology_changed_requires_attach/);
 assert.deepEqual(calls,['visual-attach','visual-detach']);
 assert.equal(row.visualSessionId,'vis_old');
 assert.equal(row.nativeStale,true);
}
{
 const row=makeRow();
 row.expiresAt=Date.now()-1000;
 let invoked=false;
 await assert.rejects(()=>reacquireNativeVisual(row,{
  requestNative:async()=>{invoked=true},isCurrent:r=>r===row
 }),/desktop_session_missing/);
 assert.equal(invoked,false);
}
{
 const row=makeRow();
 let calls=0,resolve;
 const requestNative=()=>{calls++;return new Promise(r=>{resolve=r})};
 const opts={requestNative,isCurrent:r=>r===row};
 const p1=reacquireNativeVisual(row,opts);
 const p2=reacquireNativeVisual(row,opts);
 assert.equal(calls,1,'concurrent frames must share one native attach');
 resolve({visualSessionId:'vis_shared',leaseToken:'vlease_shared',displayTopologyId:'topology_test'});
 assert.deepEqual(await p1,{recovered:true,epochChanged:true});
 assert.deepEqual(await p2,{recovered:true,epochChanged:true});
 assert.equal(calls,1);
 assert.equal(row.recovering,null);
}
{
 const row=makeRow();let calls=0;
 await assert.rejects(()=>reacquireNativeVisual(row,{
  requestNative:async()=>{calls++;throw new Error('desktop_backend_transient')},
  isCurrent:r=>r===row
 }),/desktop_backend_transient/);
 assert.equal(calls,1);
 assert.equal(row.recovering,null);
 assert.equal(row.visualSessionId,'vis_old');
}
const source=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
assert.match(source,/if\(row\.nativeStale\)\{await reacquire\(\);recovered=true;\}/);
assert.match(source,/if\(row\.visualSessionId===nativeIdBeforeFrame\)await reacquire\(\)/);
assert.match(source,/if\(!recoverableVisualFrameError\(error\)\|\|row\.stopping\)throw error/);
assert.match(source,/for\(const row of \[\.\.\.REAL_REMOTE_VISUAL\.values\(\)\]\)\{row\.nativeStale=true;row\.lastFrameSha=null;\}/);
assert.match(source,/event:'desktop_visual_native_lease_recovered'/);
assert.doesNotMatch(source,/if\(name==='robot.closed'\)[^\n]*REAL_REMOTE_VISUAL\.delete/);
console.log('RMV2_VISUAL_LEASE_RECOVERY_PASS recoverable_errors,owner_bound_rebind,topology_fail_closed,expiry_fail_closed,concurrent_singleflight,token_privacy,read_only_frame_recovery,preserve_agent_session_on_helper_exit');
