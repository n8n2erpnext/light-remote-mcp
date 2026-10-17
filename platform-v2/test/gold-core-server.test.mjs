import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {startGoldCoreApi} from '../src/http/gold-core-server.mjs';

const verifierNames=['verifyIdentityProof','verifyDeviceProof','verifyAgentPrincipal',
 'verifyWallApproval','verifyPaddleSignature','verifyOwnerProof',
 'verifyUsageEvidence','approveWallRequest','verifyAgentIngress',
 'verifyOAuthClient','verifyBillingIngress','verifyUsageIngress'];
const verifiers=Object.fromEntries(verifierNames.map(name=>[name,async()=>null]));
const make=()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gold-core-socket-'));
 const directory=path.join(root,'run');
 fs.mkdirSync(directory,{mode:0o700});
 fs.chmodSync(root,0o700);fs.chmodSync(directory,0o700);
 const socketPath=path.join(directory,'core.sock');
 const env={LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:root};
 let closed=0,alive=true;
 const openPlane=async()=>({
  pool:{query:async()=>{if(!alive)throw Error('pg_down');return{rows:[{gold_ready:1}]}},
   connect:async()=>({query:async()=>({rows:[]}),release(){}})},
  redis:{ping:async()=>alive?'PONG':'NO'},cache:{prefix:'gold:test:'},postgres:{database:'light_remote_gold_dev',
   schemaVersion:19},close:async()=>{closed++}
 });
 const core={
  login:async args=>({account:{email:args.email},token:'T'.repeat(48)}),
  authenticate:async()=>({accountId:'acct_1'}),
  logout:async()=>({loggedOut:true}),
  registerVerifiedAccount:async()=>({account_id:'acct_1'}),
  requestPairing:async()=>({requestId:'ab_1'}),
  approvePairing:async()=>({approved:true})
 };
 const team={createTeam:async()=>({teamId:'team_1'})};
 const request=(url,{method='GET',data,headers={}}={})=>
  new Promise((resolve,reject)=>{
   const body=data===undefined?null:JSON.stringify(data);
   const req=http.request({socketPath,path:url,method,headers:{
    ...headers,...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{})
   }},res=>{
    let text='';
    res.on('data',chunk=>text+=chunk);
    res.on('end',()=>resolve({status:res.statusCode,
     data:text.startsWith('{')?JSON.parse(text):text}));
   });
   req.on('error',reject);
   req.end(body||undefined);
  });
 return {root,socketPath,env,openPlane,core,team,
  request,closed:()=>closed,breakDependencies:()=>{alive=false},
  clean:()=>fs.rmSync(root,{recursive:true,force:true})};
};
test('Gold socket service refuses missing verifier before opening any PG pool',async()=>{
 const f=make(),called=[];
 try{
  await assert.rejects(()=>startGoldCoreApi({...f,verifiers:{},
   openPlane:async()=>called.push('opened')}),/gold_core_ingress_verifier_required/);
  assert.deepEqual(called,[]);
  assert.equal(fs.existsSync(f.socketPath),false);
 }finally{f.clean()}
});
test('Gold socket service refuses unverified data plane and does not bind',async()=>{
 const f=make();
 try{
  await assert.rejects(()=>startGoldCoreApi({...f,verifiers,
   openPlane:async()=>({pool:{},redis:{},postgres:null,cache:null,close:async()=>{}}),
   openCore:()=>f.core,openTeam:()=>f.team}),/gold_core_verified_data_plane_required/);
  assert.equal(fs.existsSync(f.socketPath),false);
 }finally{f.clean()}
});
test('Gold socket service refuses non-private runtime directory',async()=>{
 const f=make();
 try{
  fs.chmodSync(path.dirname(f.socketPath),0o755);
  await assert.rejects(()=>startGoldCoreApi({...f,verifiers,
   openCore:()=>f.core,openTeam:()=>f.team}),/gold_core_socket_parent_must_be_private/);
  assert.equal(fs.existsSync(f.socketPath),false);
 }finally{f.clean()}
});
test('Gold Core API boots over real private Unix socket after verified data plane; serves HTTP and cleans up',async()=>{
 const f=make();
 try{
  const active=await startGoldCoreApi({...f,verifiers,
   openCore:()=>f.core,openTeam:()=>f.team});
  assert.equal(active.socketPath,f.socketPath);
  assert.equal(fs.statSync(f.socketPath).mode&0o077,0);
  const health=await f.request('/healthz');
  assert.equal(health.status,200);
  assert.equal(health.data.database,'light_remote_gold_dev');
  assert.equal(health.data.schemaVersion,19);
  assert.equal(health.data.cutoverComplete,false);
  assert.equal((await f.request('/readyz')).status,200);
  const login=await f.request('/v1/accounts/login',{method:'POST',
   data:{email:'person@example.test',password:'private'}});
  assert.equal(login.status,200);
  assert.equal(login.data.account.email,'person@example.test');
  const unverified=await f.request('/v1/pairing/approve',{method:'POST',
   data:{requestId:'ab_1',approvalCode:'12345-12345',approved:true}});
  assert.equal(unverified.status,401);
  assert.equal((await f.request('/other')).status,404);
  f.breakDependencies();
  const unhealthy=await f.request('/readyz');
  assert.equal(unhealthy.status,503);
  assert.equal(unhealthy.data.error,'gold_core_dependency_unavailable');
  const rejectedLogin=await f.request('/v1/accounts/login',{method:'POST',
   data:{email:'person@example.test',password:'private'}});
  assert.equal(rejectedLogin.status,503,
   'an existing Core socket must stop accepting mutations when PG/Redis fail');
  await active.close();
  assert.equal(f.closed(),1);
  assert.equal(fs.existsSync(f.socketPath),false);
 }finally{f.clean()}
});
