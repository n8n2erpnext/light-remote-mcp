import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeCaptureRegion,frameCoordinateInput} from './rmv2-capture.mjs';
import policy from './real-remote-input.cjs';
const frame={frameSeq:12,capturedMono:100,displayTopologyId:'a'.repeat(64),width:100,height:50,bounds:{x:-1800,y:-100,width:200,height:100}};
test('ROI is explicit integer screen-local geometry with bounded pixels',()=>{
  assert.deepEqual(normalizeCaptureRegion({x:0,y:50,width:320,height:200}),{x:0,y:50,width:320,height:200});
  for(const r of [{x:-1,y:0,width:1,height:1},{x:0,y:0,width:0,height:1},{x:0,y:0,width:99999,height:1},{x:0,y:0,width:32768,height:32768},{x:'0',y:0,width:1,height:1}])assert.throws(()=>normalizeCaptureRegion(r));
});
test('scaled ROI pixel centers map to physical virtual coordinates including negative monitor origins',()=>{
  const input={coordinateSpace:'frame',frameSeq:12,events:[{type:'move',x:0,y:0,durationMs:0,steps:1},{type:'drag',x:1,y:1,toX:99,toY:49}]};
  const mapped=frameCoordinateInput(input,frame,{now:200});
  assert.deepEqual(mapped.events[0],{type:'move',x:-1799,y:-99,durationMs:0,steps:1});
  assert.equal(mapped.events[1].toX,-1601);assert.equal(mapped.events[1].toY,-1);
  assert.equal(mapped.displayTopologyId,frame.displayTopologyId);assert.equal(mapped.coordinateSpace,undefined);
});
test('stale frame sequence, age, topology, out-of-image and double screen offsets reject before input',()=>{
  const input={coordinateSpace:'frame',frameSeq:12,events:[{type:'click',x:20,y:10}]};
  for(const request of [{...input,frameSeq:11},{...input,displayTopologyId:'b'.repeat(64)},{...input,events:[{type:'click',x:100,y:10}]},{...input,events:[{type:'click',x:20,y:10,screen:0}]}])assert.throws(()=>frameCoordinateInput(request,frame,{now:200}));
  assert.throws(()=>frameCoordinateInput(input,frame,{now:15101}),/stale/);
  assert.throws(()=>frameCoordinateInput(input,null,{now:200}),/stale/);
});
test('frame metadata survives both input normalizers and existing virtual/screen inputs remain compatible',()=>{
  const input={desktopSessionId:'desk_abcdefgh',coordinateSpace:'frame',frameSeq:12,maxFrameAgeMs:45000,events:[{type:'move',x:1,y:2,durationMs:0,steps:1}]};
  const normalized=policy.normalizeDesktopInput(policy.normalizeDesktopInput(input,{platform:'win32'}),{platform:'win32'});
  assert.equal(normalized.frameSeq,12);assert.equal(normalized.coordinateSpace,'frame');assert.equal(normalized.maxFrameAgeMs,45000);
  const legacy={events:[{type:'move',x:1,y:2,screen:0}]};assert.equal(frameCoordinateInput(legacy,null),legacy);
});
