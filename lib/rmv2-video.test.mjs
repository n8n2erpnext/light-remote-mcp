import test from 'node:test';
import assert from 'node:assert/strict';
import {videoOptions,captureAuthorizedVideo,recentLocalVideo,validateVideoPacket,RM_VIDEO_MAX_BYTES} from './rmv2-video.mjs';
import {RmVideoRelay} from '../operator-host/rmv2-video-relay.mjs';
const id='desk_abcdefghijk';
const packet=()=>({mime:'video/h264',format:'annexb',codec:'avc1.42001f',keyFrame:true,width:128,height:96,timestampUs:0,fps:15,capturedAt:1000,encoderBackend:'media-foundation-software',hardwareEncoding:false,gpuResize:false,dataBytes:5,data:Buffer.from([0,0,0,1,0x65]).toString('base64'),bounds:{x:-100,y:0,width:256,height:192}});
function fixture(){let time=1000;const row={desktopSessionId:id,sessionId:'session',agentId:'agent',visualSessionId:'native',leaseToken:'secret',displayTopologyId:'topology',nativeEpoch:'epoch',expiresAt:45000};const owner={sessionId:'session',agentId:'agent'};let calls=0;const deps={now:()=>time,mono:()=>5,isCurrent:()=>true,requestNative:async(op,args)=>{calls++;assert.equal(op,'visual-video');assert.equal(args.leaseToken,'secret');return {frameSeq:calls,displayTopologyId:'topology',epoch:'epoch',video:packet()};}};return {row,owner,deps,get calls(){return calls;},tick:value=>time=value};}
test('video options and media budgets reject unsupported rates, scopes, codecs and oversized frames',()=>{
 assert.equal(videoOptions({desktopSessionId:id}).fps,15);
 for(const fps of [0,31,NaN,2.5,'15'])assert.throws(()=>videoOptions({desktopSessionId:id,fps}));
 assert.throws(()=>videoOptions({desktopSessionId:'vis_native'}));
 for(const value of [{...packet(),keyFrame:false},{...packet(),width:127},{...packet(),dataBytes:RM_VIDEO_MAX_BYTES+1},{...packet(),data:'<script>'}])assert.throws(()=>validateVideoPacket(value));
});
test('current exact actor captures once; durable job result omits all media while signed relay receives it',async()=>{
 const x=fixture();let pushed;
 x.deps.sendVideo=async native=>{pushed=native;};
 const result=await captureAuthorizedVideo(x.row,x.owner,{desktopSessionId:id,includeData:true},x.deps);
 assert.equal(x.calls,1);assert.equal(result.video.data,undefined);assert.equal(pushed.video.data,packet().data);assert.equal(x.row.latestVideo.video.data,packet().data);
 assert.equal(x.row.lastFrameMap.width,128);assert.equal(x.row.videoInFlight,false);
 await assert.rejects(captureAuthorizedVideo(x.row,x.owner,{desktopSessionId:id},x.deps),/throttled/);
});
test('wrong actor, expired/closed/stale scope cannot request native video',async()=>{
 for(const mutate of [x=>x.owner.agentId='other',x=>x.row.closing=true,x=>x.row.nativeStale=true,x=>x.row.expiresAt=999,x=>x.deps.isCurrent=()=>false]){
  const x=fixture();mutate(x);await assert.rejects(captureAuthorizedVideo(x.row,x.owner,{desktopSessionId:id},x.deps),/scope/);assert.equal(x.calls,0);
 }
});
test('concurrent capture is bounded and close during native work discards late pixels',async()=>{
 const x=fixture();let finish;
 x.deps.requestNative=()=>new Promise(resolve=>finish=resolve);
 const first=captureAuthorizedVideo(x.row,x.owner,{desktopSessionId:id},x.deps);
 await assert.rejects(captureAuthorizedVideo(x.row,x.owner,{desktopSessionId:id},x.deps),/busy/);
 x.row.closing=true;finish({frameSeq:1,displayTopologyId:'topology',epoch:'epoch',video:packet()});await assert.rejects(first,/scope/);
 assert.equal(x.row.latestVideo,undefined);assert.equal(x.row.videoInFlight,false);
});
test('Owner observer neither captures nor renews and sends no duplicate payload; hidden stale view clears',async()=>{
 const x=fixture();await captureAuthorizedVideo(x.row,x.owner,{desktopSessionId:id},x.deps);const expiry=x.row.expiresAt;
 assert.equal(recentLocalVideo([x.row],{now:1100})[0].video.data,packet().data);
 assert.equal(recentLocalVideo([x.row],{now:1100,desktopSessionId:id,afterSeq:1,afterEpoch:'epoch'})[0].video.data,undefined);
 assert.deepEqual(recentLocalVideo([x.row],{now:3001}),[]);assert.deepEqual(recentLocalVideo([x.row],{now:1100,desktopAllowed:false}),[]);
 assert.equal(x.row.expiresAt,expiry);assert.equal(x.calls,1);
});
test('ephemeral relay binds all actor dimensions, enforces TTL/sequence and bounded memory',()=>{
 let now=1000;const relay=new RmVideoRelay({now:()=>now,maxBytes:9000});
 const owner={accountId:'account',deviceId:'device',sessionId:'session',agentId:'agent',desktopSessionId:id};
 try{
  relay.push(owner,{frameSeq:1,epoch:'epoch',video:packet()});assert.equal(relay.read(owner).video.data,undefined);assert.equal(relay.read(owner,{includeData:true}).video.data,packet().data);
  for(const key of Object.keys(owner))assert.throws(()=>relay.read({...owner,[key]:'other'}),/no_recent/);
  assert.throws(()=>relay.push(owner,{frameSeq:1,epoch:'epoch',video:packet()}),/sequence/);
  for(let i=0;i<5;i++)relay.push({...owner,desktopSessionId:'desk_'+i},{frameSeq:1,epoch:'epoch',video:packet()});assert.ok(relay.bytes<=9000);assert.ok(relay.rows.size<=2);
  now=3001;assert.throws(()=>relay.read(owner,{includeData:true}),/no_recent/);assert.equal(relay.bytes,0);
  relay.push(owner,{frameSeq:2,epoch:'epoch',video:packet()});relay.close(owner);assert.equal(relay.rows.size,0);
 }finally{relay.dispose();}
});
