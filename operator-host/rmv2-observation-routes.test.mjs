import crypto from 'node:crypto';
import {observationTicket} from '../lib/rmv2-observation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {handleDeviceChannelRoutes} from './executor-routes-device-channel.mjs';
import {handleRuntimeRoutes} from './executor-routes-runtime.mjs';
import {RmObservationRelay} from './rmv2-observation-relay.mjs';
import {apiPath} from '../lib/api-contract.mjs';
test('signed media push and private plugin read enforce current grant and actor; media stays outside jobs',async()=>{
 let body,revoked=false,signed=true,saved=0;
 const session={id:'session',agentId:'agent',accountId:'account',deviceId:'device',nodeId:'node',state:'active'};
 const grant={grantId:'grant',agentId:'agent',accountId:'account',purpose:'device',expiresAt:Date.now()+60000,absoluteExpiresAt:Date.now()+60000};
 const relay=new RmObservationRelay();
 const deps={realRemoteObservation:relay,readJson:async()=>body,
  verifiedChannelContext:async (_body,action)=>{assert.equal(action,'desktop-observation-push');if(!signed)throw Error('proof_invalid');return {payload:body.payload,device:{deviceId:'device'},binding:{accountId:'account'}};},
  sessions:{get:(id,agent)=>{if(id!==session.id||agent!==session.agentId)throw Error('actor_mismatch');return session;},ensure:(id,{agentId})=>{if(id!==session.id||agentId!==session.agentId)throw Error('actor_mismatch');return session;}},
  accounts:{assertOperational:()=>{}},requireDeviceConnection:()=>({connectionId:'connection',hardExpiresAt:Date.now()+60000}),targetRoute:()=>({deviceId:'device',capabilities:['desktop']}),
  accessGrants:{activeGrantsForDevice:()=>[grant],assert:()=>{if(revoked)throw Error('grant_revoked');return grant;}},
  DeviceAccessGrantError:class extends Error{},sendJson:(_res,status,data)=>({status,data}),goldJobs:{save:()=>{saved++;}},pushEvent:()=>{saved++;}};
 const res={setHeader:(key,value)=>{assert.equal(key,'Cache-Control');assert.equal(value,'no-store');}};
 const observationId='obs_'+'a'.repeat(32),observationEpoch='oepoch_'+'b'.repeat(32);
 const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6vWQAAAAASUVORK5CYII=','base64');
 const packet={epoch:'epoch',frameSeq:1,displayTopologyId:'topology',observation:{observationId,observationEpoch,sourceSeq:1,state:'changed',profile:'precision',sourceBackend:'dxgi-d3d11',gpuCapture:true,lossless:true,resampled:false,width:1,height:1,sourceValidationAgeMs:2,physicalBounds:{x:0,y:0,width:1,height:1},image:{mimeType:'image/png',data:bytes.toString('base64'),dataBytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}};
 const push={sessionId:'session',agentId:'agent',desktopSessionId:'desk_abcdefgh',observationId,...packet};
 try{
  body={payload:push};signed=false;await assert.rejects(handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopObservationPushInternal'),'http://localhost'),deps),/proof/);assert.equal(relay.bytes,0);
  signed=true;const accepted=await handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopObservationPushInternal'),'http://localhost'),deps);assert.equal(accepted.data.observation.storage,'bounded-ram-only');
  const read=async changes=>{body={accountId:'account',sessionId:'session',agentId:'agent',desktopSessionId:'desk_abcdefgh',...observationTicket(packet),...changes};return handleRuntimeRoutes({method:'POST'},res,new URL(apiPath('desktopObservationReadInternal'),'http://localhost'),deps);};
  assert.equal((await read()).data.packet.observation.image.data,packet.observation.image.data);
  await assert.rejects(read({agentId:'foreign'}),/actor/);await assert.rejects(read({accountId:'foreign'}),/account/);
  revoked=true;await assert.rejects(read(),/revoked/);revoked=false;
  body={payload:{...push,closed:true}};await handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopObservationPushInternal'),'http://localhost'),deps);assert.equal(relay.bytes,0);
  body={payload:{...push,frameSeq:2}};await assert.rejects(handleDeviceChannelRoutes({method:'POST'},res,new URL(apiPath('desktopObservationPushInternal'),'http://localhost'),deps),/scope_closed/);
  await assert.rejects(read(),/no_recent/);
  assert.equal(saved,0);
 }finally{relay.dispose();}
});
