import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {NativeDesktopBridge} from '../../lib/native-desktop.mjs';
const {normalizeDesktopInput}=createRequire(import.meta.url)('../../lib/real-remote-input.cjs');

// Operator and Agent both normalize. Exercise both, then the real bridge mapper
// and response path, without injecting any input on the development machine.
let native;
const bridge=new NativeDesktopBridge({command:'contract-only',platform:'win32',idleMs:600000});
bridge._start=async()=>{};
bridge.socket={write(line){
  native=JSON.parse(line);
  bridge._onData(JSON.stringify({type:'response',id:native.id,ok:true,data:{received:native.actions,nativeTiming:{handlerMs:0.2,requestId:native.id}}})+'\n');
}};
try {
  for(const raw of [
    {type:'move',x:-101,y:5,durationMs:0,steps:1},
    {type:'move',x:1,y:2,screen:0,durationMs:500,steps:32},
    {type:'move',x:5,y:9},
    {type:'drag',x:1,y:2,toX:3,toY:4,durationMs:0,steps:1},
    {type:'text',text:'Đây là Light Remote 👩🏽‍💻',intervalMs:0},
  ]) {
    const normalized=normalizeDesktopInput(normalizeDesktopInput({events:[raw]},{platform:'win32'}),{platform:'win32'});
    const response=await bridge.request('input',normalized);
    const action=native.actions[0];
    if(raw.durationMs!=null)assert.equal(action.durationMs,raw.durationMs);
    if(raw.steps!=null)assert.equal(action.steps,raw.steps);
    if(raw.type==='move') { assert.equal(action.x,raw.x); assert.equal(action.y,raw.y); }
    if(raw.type==='text') { assert.equal(action.text,raw.text); assert.equal(action.intervalMs,0); }
    assert.equal(response.bridgeTiming.requestId,response.nativeTiming.requestId);
    assert.ok(Number.isFinite(response.bridgeTiming.roundtripMs));
    assert.deepEqual(response.received,native.actions);
  }
  const scoped=normalizeDesktopInput(normalizeDesktopInput({desktopSessionId:'desk_contract123',events:[{type:'move',x:1,y:2,durationMs:0,steps:1}]}));
  assert.equal(scoped.desktopSessionId,'desk_contract123');
  await bridge.request('input',{...scoped,visualSessionId:'vis_private123',leaseToken:'vlease_private123'});
  assert.equal(native.visualSessionId,'vis_private123');assert.equal(native.leaseToken,'vlease_private123');
  await bridge.request('run',{events:[{type:'move',x:1,y:2}],visualSessionId:'vis_private123',leaseToken:'vlease_private123'});
  assert.equal(native.visualSessionId,'vis_private123');
  await bridge.request('semantic-act',{semanticSessionId:'sem_contract123',nodeId:'n1',action:'invoke',visualSessionId:'vis_private123',leaseToken:'vlease_private123'});
  assert.equal(native.visualSessionId,'vis_private123');
  for(const profile of ['compatibility','precision','responsive','smooth']) {
    const value=normalizeDesktopInput(normalizeDesktopInput({events:[{type:'click',x:1,y:2,profile}]}));
    await bridge.request('input',value);
    assert.equal(native.actions[0].profile,profile);assert.equal(native.actions[1].profile,profile);
    if(['precision','responsive'].includes(profile)){assert.equal(native.actions[0].durationMs,0);assert.equal(native.actions[0].steps,1);}
  }
  assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:1,y:2,profile:'unsafe'}]}),/desktop_input_invalid_profile/);
  await bridge.request('cancel',{visualSessionId:'vis_private123',leaseToken:'vlease_private123'});
  assert.equal(native.op,'desktop.cancel');assert.equal(native.visualSessionId,'vis_private123');assert.equal(native.leaseToken,'vlease_private123');
  for(const invalid of [{durationMs:-1},{durationMs:501},{steps:0},{steps:33}])
    assert.throws(()=>normalizeDesktopInput({events:[{type:'move',x:0,y:0,...invalid}]}),/desktop_input_invalid/);
  assert.deepEqual(normalizeDesktopInput({events:[{type:'move',x:1,y:2}]}).events,[{type:'move',x:1,y:2}]);
  console.log('RMV2_DOUBLE_NORMALIZATION_NATIVE_MAPPING_ZERO_TIMING=PASS');
} finally { bridge.socket=null; bridge.close(); }
