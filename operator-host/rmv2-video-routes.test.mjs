import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDeviceChannelRoutes} from './executor-routes-device-channel.mjs';
import {handleRuntimeRoutes} from './executor-routes-runtime.mjs';
import {RmVideoRelay} from './rmv2-video-relay.mjs';
import {apiPath} from '../lib/api-contract.mjs';
test('signed media push and private plugin read enforce current grant and actor; media stays outside jobs',async()=>{
 let body,revoked=false,signed=true,saved=0;
 const session={id:'session',agentId:'agent',accountId:'account',deviceId:'device',nodeId:'node',state:'active'};
 const grant={grantId:'grant',agentId:'agent',accountId:'account',purpose:'device',expiresAt:Date.now()+60000,absoluteExpiresAt:Date.now()+60000};
 const relay=new RmVideoRelay();
 const deps={realRemoteVideo:relay,readJson:async()=>body,
  verifiedChannelContext:async (_body,action)=>{assert.equal(action,'desktop-video-push');if(!signed)throw Error('proof_invalid');return {payload:body.payload,device:{deviceId:'device'},binding:{accountId:'account'}};},
  sessions:{get:(id,agent)=>{if(id!==session.id||agent!==session.agentId)throw Error('actor_mismatch');return session;},ensure:(id,{agentId})=>{if(id!==session.id||agentId!==session.agentId)throw Error('actor_mismatch');return session;}},
  accounts:{assertOperational:()=>{}},requireDeviceConnection:()=>({connectionId:'connection',hardExpiresAt:Date.now()+60000}),targetRoute:()=>({deviceId:'device',capabilities:['desktop']}),
  accessGrants:{activeGrantsForDevice:()=>[grant],assert:()=>{if(revoked)throw Error('grant_revoked');return grant;}},
  DeviceAccessGrantError:class extends Error{},sendJson:(_res,status,data)=>({status,data}),goldJobs:{save:()=>{saved++;}},pushEvent:()=>{saved++;}};
 const res={setHeader:(key,value)=>{assert.equal(key,'Cache-Control');assert.equal(value,'no-store');}};
 const packet={mime:'video/h264',format:'annexb',codec:'avc1.42001f',keyFrame:true,width:128,height:96,timestampUs:0,fps:15,capturedAt:1000,encoderBackend:'media-foundation-software',hardwareEncoding:false,gpuResize:false,dataBytes:5,data:Buffer.from([0,0,0,1,0x65]).toString('base64')};
 const push={sessionId:'session',agentId:'agent',desktopSessionId:'desk_abcdefgh',epoch:'epoch',frameSeq:1,video:packet};
 try{
  body={payload:push};signed=false;await assert.rejects(handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopVideoPushInternal'),'http://localhost'),deps),/proof/);assert.equal(relay.bytes,0);
  signed=true;const accepted=await handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopVideoPushInternal'),'http://localhost'),deps);assert.equal(accepted.data.video.storage,'bounded-ram-only');
  const read=async changes=>{body={accountId:'account',sessionId:'session',agentId:'agent',desktopSessionId:'desk_abcdefgh',includeData:true,...changes};return handleRuntimeRoutes({method:'POST'},res,new URL(apiPath('desktopVideoReadInternal'),'http://localhost'),deps);};
  assert.equal((await read()).data.video.video.data,packet.data);
  await assert.rejects(read({agentId:'foreign'}),/actor/);await assert.rejects(read({accountId:'foreign'}),/account/);
  revoked=true;await assert.rejects(read(),/revoked/);revoked=false;
  body={payload:{...push,closed:true}};await handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopVideoPushInternal'),'http://localhost'),deps);assert.equal(relay.bytes,0);
  body={payload:{...push,frameSeq:2}};await assert.rejects(handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopVideoPushInternal'),'http://localhost'),deps),/scope_closed/);
  await assert.rejects(read(),/no_recent/);
  assert.equal(saved,0);
 }finally{relay.dispose();}
});
