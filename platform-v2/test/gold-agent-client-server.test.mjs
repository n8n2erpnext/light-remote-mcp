import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';

test('Gold private Core socket forwards Agent attach/resolve to a PG authority and denies DB loss',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-agent-socket-'));
 const run=path.join(root,'run');fs.mkdirSync(run,{mode:0o700});
 const socketPath=path.join(run,'gold.sock');
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 let online=true,closed=false,called=[];
 const names=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
  'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
  'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
  'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress',
 'verifyDeviceChannelIngress','verifyChannelEnvelope'];
 const verifiers=Object.fromEntries(names.map(name=>[name,async()=>null]));
 verifiers.verifyAgentIngress=async()=>({agentId:'agent_trusted',agentProof:'verified'});
 const plane=async()=>({pool:{query:async()=>online?
   {rows:[{gold_ready:1}]}:Promise.reject(Error('pg_unavailable'))},
  redis:{ping:async()=>online?'PONG':'OFFLINE'},
  postgres:{database:'light_remote_gold_dev',schemaVersion:20},
  cache:{prefix:'lr:gold:example:'},close:async()=>{closed=true}});
 const agent={
  attach:async input=>{called.push(['attach',input]);return {
   client:{clientSessionId:'lrc_pg',agentId:input.agentId},
   device:{deviceId:'dev_pg'}}},
  resolve:async input=>{called.push(['resolve',input]);return {
   binding:{clientSessionId:input.clientSessionId,deviceId:'dev_pg'}}},
  findActive:async input=>{called.push(['findActive',input]);return {
   client:{clientSessionId:'lrc_pg',agentId:input.agentId},devices:[{deviceId:'dev_pg'}]}},
  listDevices:async input=>{called.push(['listDevices',input]);return {
   client:{clientSessionId:input.clientSessionId,agentId:input.agentId},
   devices:[{deviceId:'dev_pg'}]}}
 };
 const remoteSessions={context:async input=>{
  called.push(['context',input]);return{
   context:{clientSessionId:input.clientSessionId,agentId:input.agentId,
    deviceId:'dev_pg',sessionId:'s_pg_1234567890',workspace:input.workspace||''},
   session:{sessionId:'s_pg_1234567890',accountId:'acct_member',
    deviceId:'dev_pg',state:'active'}}}};
 const request=(route,body=null)=>new Promise((resolve,reject)=>{
  const data=body===null?null:JSON.stringify(body);
  const req=http.request({socketPath,path:route,method:data===null?'GET':'POST',
   headers:data===null?{}:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{
   let raw='';res.on('data',d=>raw+=d);res.on('end',()=>resolve({
    status:res.statusCode,body:raw.startsWith('{')?JSON.parse(raw):raw}));
  });
  req.on('error',reject);req.end(data||undefined);
 });
 let core;
 try{
  core=await startGoldCoreApi({env,socketPath,verifiers,openPlane:plane,
   openCore:()=>({}),openTeam:()=>({}),openAgent:()=>agent,
   openRemoteSessions:()=>remoteSessions,
   openDeviceChannel:()=>({connect:async()=>({}),renew:async()=>({}),
    disconnect:async()=>({}),setGrace:async()=>({})})});
  const attached=await request('/v1/agent-client/attach',{
   grantId:'grant_pg',agentId:'forged'});
  assert.equal(attached.status,200);
  assert.equal(attached.body.client.clientSessionId,'lrc_pg');
  assert.equal(called[0][1].agentId,'agent_trusted');
  const resolved=await request('/v1/agent-client/resolve',{
   clientSessionId:'lrc_pg',agentId:'forged'});
  assert.equal(resolved.status,200);
  assert.equal(called[1][1].agentProof,'verified');
  const resumed=await request('/v1/agent-client/by-agent?accountId=forged&agentId=forged');
  assert.equal(resumed.status,200);
  assert.equal(resumed.body.client.clientSessionId,'lrc_pg');
  assert.equal(called[2][1].agentId,'agent_trusted');
  const devices=await request('/v1/agent-client/lrc_pg/devices?agentId=forged');
  assert.equal(devices.status,200);
  assert.equal(devices.body.devices[0].deviceId,'dev_pg');
  assert.equal(called[3][1].agentProof,'verified');
  const context=await request('/v1/agent-client/context',{
   clientSessionId:'lrc_pg',agentId:'forged',accountId:'forged',
   workspace:'/home/example',gracePreset:'60m'});
  assert.equal(context.status,200);
  assert.equal(context.body.session.sessionId,'s_pg_1234567890');
  assert.equal(called[4][1].agentId,'agent_trusted');
  assert.equal(called[4][1].agentProof,'verified');
  online=false;
  const denied=await request('/v1/agent-client/context',{
   clientSessionId:'lrc_pg'});
  assert.equal(denied.status,503);
  assert.equal(called.length,5,'no authority call after real dependency check fails');
 }finally{
  await core?.close();fs.rmSync(root,{recursive:true,force:true});
 }
 assert(closed);
});
