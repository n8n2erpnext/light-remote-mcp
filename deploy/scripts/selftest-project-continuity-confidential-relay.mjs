import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {provisionContinuityOwnerAuthority,signContinuityConsent} from '../../device-agent/project-continuity-owner-grants.mjs';
import {continuityRequest,startContinuityServer} from '../../device-agent/project-continuity-ipc.mjs';
import {handleDeviceDuplexSession,confidentialProjectRequest} from '../../operator-host/device-duplex-session.mjs';
import {DEVICE_DUPLEX_PROTOCOL,DeviceDuplexClient} from '../../lib/device-duplex-client.mjs';
import {handlePluginRoutes} from '../../operator-host/executor-routes-plugin.mjs';
import {createProjectReadDelegation,verifyProjectReadDelegation} from '../../lib/project-continuity-session-proof.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(f,limit=2500){
 const until=Date.now()+limit;
 while(Date.now()<until){const v=f();if(v)return v;await sleep(8);}
 throw Error('continuity_test_timeout');
}
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-confidential-relay-'));
class MockResponse extends PassThrough{
 constructor(){super();this.statusCode=0;this.headersSent=false;this.socket={setNoDelay(){},setKeepAlive(){}};}
 writeHead(code,headers){this.statusCode=code;this.headers=headers;this.headersSent=true;return this;}
 flushHeaders(){}
}
let local=null;
let stream=null;
try {
 const signerDir=path.join(root,'owner-priv'),password='reliable-test-password-for-signature';
 provisionContinuityOwnerAuthority({root,signerDir,password});
 const db=new ContinuityStore({root});
 const project=db.createProject({projectName:'Private gold',workspace:'/workspace/read-only'});
 db.setModules(project.id,{memory:true,expectedRevision:1});
 db.memoryPut(project.id,{body:'Local project decisions stay on device',sourceRef:'owner:handoff'});
 // Full local Memory exists but is NOT authorized over any remote path.
 assert.throws(()=>db.remoteBrief(project.id),/continuity_remote_read_denied/);
 assert.throws(()=>db.setRemoteReadConsent(project.id,{proof:{}}),/continuity_owner_grant_invalid/);
 db.close();
 local=startContinuityServer({root});
 await waitFor(()=>local.server.listening);
 await assert.rejects(continuityRequest('remoteBrief',{projectId:project.id},{root}),/continuity_remote_read_denied/);
 // Generic local IPC CANNOT mint consent, even if it knows the local token.
 await assert.rejects(continuityRequest('setRemoteReadConsent',{projectId:project.id,enabled:true,ownerVerified:true},{root}),/continuity_unknown_action/);
 await assert.rejects(continuityRequest('applySignedOwnerConsent',{projectId:project.id,proof:{grant:{},signature:'fake'}},{root}),/continuity_owner_grant_scope_invalid/);
 await local.stop();local=null;
 const ownerDb=new ContinuityStore({root});
 const firstGrant=signContinuityConsent({root,signerDir,password,projectId:project.id,enabled:true,revision:ownerDb.project(project.id).revision,principal:'local-owner'});
 ownerDb.setRemoteReadConsent(project.id,{proof:firstGrant});
 assert.throws(()=>ownerDb.setRemoteReadConsent(project.id,{proof:firstGrant}),/continuity_stale_revision/);
 ownerDb.close();
 local=startContinuityServer({root});await waitFor(()=>local.server.listening);
 const approved=await continuityRequest('remoteBrief',{projectId:project.id,maxChars:8000},{root});
 assert.match(approved.content,/Local project decisions stay on device/);
 assert.ok(approved.content.length<=8000);
 assert.ok(Buffer.byteLength(approved.content,'utf8')<=7000);
 await local.stop();local=null;
 const revoker=new ContinuityStore({root});
 const current=revoker.project(project.id);
 const memoryOff=revoker.setModules(project.id,{memory:false,expectedRevision:current.revision});
 revoker.setModules(project.id,{memory:true,expectedRevision:memoryOff.revision});
 assert.throws(()=>revoker.remoteBrief(project.id),/continuity_remote_read_denied/);
 revoker.close();
 // Re-consent is required after revoking and re-enabling Memory.
 const ownerDb2=new ContinuityStore({root});
 const secondGrant=signContinuityConsent({root,signerDir,password,projectId:project.id,enabled:true,revision:ownerDb2.project(project.id).revision,principal:'local-owner'});
 ownerDb2.setRemoteReadConsent(project.id,{proof:secondGrant});
 ownerDb2.close();
 console.log('P2_LOCAL_PROJECT_REMOTE_CONSENT_DENY_DEFAULT_PASS');

 const req=new PassThrough(),res=new MockResponse();let wire='';
 res.setEncoding('utf8');res.on('data',s=>wire+=s);
 let persistCalls=0;
 const transportEvents=[];
 stream={req,res,promise:handleDeviceDuplexSession(req,res,{
  authorizeHello:async hello=>({deviceId:'confidential-device-1',transportEpoch:hello.transportEpoch}),
  resume:async()=>{},poll:async()=>{await sleep(20);return {command:null};},
  onResult:async()=>{persistCalls++;throw Error('ordinary_job_used');},
  onLive:async()=>({}),onHeartbeat:async()=>({}),
  onEvent:event=>transportEvents.push(event)
 })};
 const epoch='confidential-epoch-1';
 req.write(JSON.stringify({type:'hello',protocol:DEVICE_DUPLEX_PROTOCOL,transportEpoch:epoch})+'\n');
 await waitFor(()=>wire.includes('"hello-ack"'));
 const signing=crypto.generateKeyPairSync('ed25519');
 const issue=(requestId,query='',maxChars=1000,deviceId='confidential-device-1')=>createProjectReadDelegation({
  privateKey:signing.privateKey,accountId:'account-1',deviceId,agentId:'agent1',
  sessionId:'session123',projectId:project.id,requestId,query,maxChars
 });
 const requestId=crypto.randomUUID();
 const deviceCall=confidentialProjectRequest({
  deviceId:'confidential-device-1',sessionId:'session123',projectId:project.id,
  query:'decisions',maxChars:1000,requestId,proof:issue(requestId,'decisions')});
 const outgoing=await waitFor(()=>wire.trim().split('\n').map(line=>JSON.parse(line)).find(frame=>frame.type==='project-request'));
 assert.equal(outgoing.request.projectId,project.id);
 assert.equal(outgoing.request.sessionId,'session123');
 req.write(JSON.stringify({type:'project-result',transportEpoch:epoch,clientSeq:1,response:{
  requestId:outgoing.request.requestId,ok:true,data:{projectId:project.id,content:'PRIVATE_CANARY_2070_dev_only',sequence:2}
 }})+'\n');
 const received=await deviceCall;
 assert.equal(received.content,'PRIVATE_CANARY_2070_dev_only');
 assert.equal(JSON.stringify(transportEvents).includes('PRIVATE_CANARY_2070_dev_only'),false);
 assert.equal(persistCalls,0);
 await waitFor(()=>wire.includes('"client-ack"'));
 await assert.rejects(confidentialProjectRequest({deviceId:'missing',sessionId:'session123',projectId:project.id}),/continuity_device_stream_unavailable/);
 const timeoutId=crypto.randomUUID();
 await assert.rejects(confidentialProjectRequest({
  deviceId:'confidential-device-1',sessionId:'session123',projectId:project.id,
  maxChars:1000,requestId:timeoutId,proof:issue(timeoutId),timeoutMs:1000
 }),/continuity_device_response_timeout/);
 req.write(JSON.stringify({type:'close',transportEpoch:epoch,clientSeq:2})+'\n');await stream.promise;
 await assert.rejects(confidentialProjectRequest({deviceId:'confidential-device-1',sessionId:'session123',projectId:project.id}),/continuity_device_stream_unavailable/);
 stream=null;
 console.log('P2_OPERATOR_DUPLEX_EPHEMERAL_NO_JOB_RECEIPTS_PASS');

 let captured=null;
 const client=new DeviceDuplexClient({onProjectRequest:async r=>{
  if(r.projectId!==project.id)throw Error('continuity_remote_read_denied');
  return {projectId:r.projectId,content:'ephemeral client reply'};
 }});
 client.ready=true;
 client._ackServer=async()=>{};
 client._sendTracked=async(type,data)=>{captured={type,data};};
 await client._handleLine(JSON.stringify({type:'project-request',request:{requestId:project.id,projectId:project.id}}));
 await waitFor(()=>captured);
 assert.equal(captured.type,'project-result');
 assert.equal(captured.data.response.data.content,'ephemeral client reply');
 assert.equal(client.commandResults.size,0);
 captured=null;
 await client._handleLine(JSON.stringify({type:'project-request',request:{requestId:project.id,projectId:'other-project'}}));
 await waitFor(()=>captured);
 assert.equal(captured.data.response.ok,false);
 assert.equal(captured.data.response.error,'continuity_remote_read_denied');
 console.log('P2_DEVICE_READ_ONLY_DUPLEX_RESPONSE_NO_COMMAND_CACHE_PASS');

 const previousFlag=process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
 process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL='1';
 try {
  let routeCalls=0,transportBoundDevice=null;
  const deps={
   accounts:{account:()=>({accountId:'account-1'})},
   sessions:{get:()=>({sessionId:'session123',agentId:'agent1',deviceId:'bound-device',accountId:'account-1',state:'active'})},
   AccountError:class extends Error{},readJson:async()=>({accountId:'account-1',agentId:'agent1',sessionId:'session123',deviceId:'UNTRUSTED_DEVICE',projectId:project.id}),
   requireDeviceConnection:deviceId=>assert.equal(deviceId,'bound-device'),
   signScopedContinuityRead:args=>issue(args.requestId,args.query,args.maxChars,args.deviceId),
   confidentialProjectRequest:async args=>{
    routeCalls++;transportBoundDevice=args.deviceId;
    verifyProjectReadDelegation({proof:args.proof,publicKey:signing.publicKey,
      accountId:'account-1',deviceId:'bound-device',projectId:project.id,
      requestId:args.requestId,query:args.query,maxChars:args.maxChars});
    return {content:'device-only result',projectId:project.id};
   },
   sendJson:(res,status,body)=>{res.statusCode=status;res.body=body;res.headersSent=true;return body;}
  };
  const routeResponse={headersSent:false,writeHead(code,headers){this.statusCode=code;this.headers=headers;this.headersSent=true;return this;},
    end(body){this.body=JSON.parse(body);}};
  await handlePluginRoutes({method:'POST'},routeResponse,new URL('http://local/v1/plugin/project-continuity/read'),deps);
  assert.equal(routeCalls,1);
  assert.equal(transportBoundDevice,'bound-device');
  assert.equal(routeResponse.statusCode,200);
  assert.equal(routeResponse.statusCode,200);
  assert.equal(routeResponse.headers['cache-control'],'no-store, private');
  assert.equal(routeResponse.body.data.content,'device-only result');
  assert.equal(routeResponse.body.job,undefined);
  deps.sessions.get=()=>({sessionId:'session123',deviceId:'bound-device',accountId:'different-account',state:'active'});
  await assert.rejects(handlePluginRoutes({method:'POST'}, {headersSent:false},new URL('http://local/v1/plugin/project-continuity/read'),deps),/plugin_session_account_mismatch/);
  console.log('P2_MCP_OPERATOR_DEVICE_ACCOUNT_SESSION_BINDING_PASS');
 }finally{
  if(previousFlag===undefined)delete process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL;
  else process.env.LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=previousFlag;
 }
 console.log('P2_CONFIDENTIAL_RELAY_FOCUSED_CHECKS_PASS');
}finally{
 try{await local?.stop();}catch{}
 if(stream){try{stream.req.end();await stream.promise;}catch{}}
 fs.rmSync(root,{recursive:true,force:true});
}
