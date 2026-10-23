import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {once} from 'node:events';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {startContinuityServer,continuityRequest} from '../../device-agent/project-continuity-ipc.mjs';
import {provisionContinuityOwnerAuthority,signContinuityConsent,verifyContinuityConsent} from '../../device-agent/project-continuity-owner-grants.mjs';
import {writeLocalWallAuthConfig,loadLocalWallAuth,LOCAL_WALL_COOKIE} from '../../device-agent/local-wall-auth.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-cont-owner-'));
const signerDir=path.join(root,'wall-secrets'),password='a-long-test-owner-password!42';
let service,wall;
try{
 provisionContinuityOwnerAuthority({root,signerDir});
 const conf=path.join(signerDir,'wall-auth.json');
 writeLocalWallAuthConfig(conf,{username:'owner',password});
 const auth=loadLocalWallAuth(conf,{required:true});
 const db=new ContinuityStore({root});
 const project=db.createProject({projectName:'Step-up protected'});
 db.setModules(project.id,{memory:true,expectedRevision:1});
 db.memoryPut(project.id,{body:'Owner-approved note',sourceRef:'owner:typed'});
 assert.equal(db.project(project.id).remote_read_enabled,0);
 const outsider=db.createProject({projectName:'Unrelated private project'});
 db.setModules(outsider.id,{memory:true,expectedRevision:1});
 const stale=signContinuityConsent({root,signerDir,projectId:project.id,enabled:true,revision:db.project(project.id).revision,principal:'owner',now:Date.now()-180000});
 assert.throws(()=>db.setRemoteReadConsent(project.id,{proof:stale}),/continuity_owner_grant_expired/);
 const altered=signContinuityConsent({root,signerDir,projectId:project.id,enabled:true,revision:db.project(project.id).revision,principal:'owner'});
 altered.grant.enabled=false;
 assert.throws(()=>db.setRemoteReadConsent(project.id,{proof:altered}),/continuity_owner_signature_invalid/);
 assert.throws(()=>db.setRemoteReadConsent(outsider.id,{proof:altered}),/continuity_owner_grant_scope_invalid/);
 const invalidSignerDir=path.join(root,'rogue');
 const rogueRoot=path.join(root,'rogue-public');
 provisionContinuityOwnerAuthority({root:rogueRoot,signerDir:invalidSignerDir});
 const wrongSignature=signContinuityConsent({root:rogueRoot,signerDir:invalidSignerDir,projectId:project.id,enabled:true,revision:db.project(project.id).revision,principal:'owner'});
 assert.throws(()=>db.setRemoteReadConsent(project.id,{proof:wrongSignature}),/continuity_owner_signature_invalid/);
 db.close();
 service=startContinuityServer({root});
 await once(service.server,'listening');
 // Local signed requests cannot be created using the IPC token alone.
 await assert.rejects(continuityRequest('applySignedOwnerConsent',{projectId:project.id,proof:{grant:{},signature:'wrong'}},{root}),/continuity_owner_grant_scope_invalid/);
 const ownerConsent=async({principal,projectId,enabled,expectedRevision,password:provided})=>{
  if(!auth.verifyCredentials(principal,provided))throw Error('invalid_owner_credentials');
  const live=await continuityRequest('getProject',{projectId},{root});
  if(live.revision!==expectedRevision)throw Error('continuity_stale_revision');
  const proof=signContinuityConsent({root,signerDir,projectId,enabled,revision:expectedRevision,principal});
  return continuityRequest('applySignedOwnerConsent',{projectId,proof},{root});
 };
 wall=startLocalWall({host:'127.0.0.1',port:0,brandSvgPath:path.join(process.cwd(),'assets/branding/light-remote-mark.svg'),auth,
  getLocalStatus:async()=>({cloudDesiredConnected:false,cloudState:'dormant'}),
  continuity:{request:(action,data)=>continuityRequest(action,data,{root}),ownerConsent}});
 await once(wall.server,'listening');
 const origin='http://127.0.0.1:'+wall.server.address().port;
 const token=auth.issue('owner').token;
 const cookie=LOCAL_WALL_COOKIE+'='+token;
 const csrf=auth.csrfForRequest({headers:{cookie}});
 const post=(credentials,headers={})=>fetch(origin+'/api/project-continuity/setRemoteReadConsent',{method:'POST',headers:{cookie,'content-type':'application/json',...headers},body:JSON.stringify({projectId:project.id,enabled:true,expectedRevision:2,password:credentials})});
 let response=await post(password);assert.equal(response.status,403);
 response=await post('incorrect-password',{'x-light-remote-csrf':csrf});assert.equal(response.status,403);
 response=await post(password,{'x-light-remote-csrf':csrf});
 assert.equal(response.status,200);
 const granted=(await response.json()).result;assert.equal(granted.remoteReadEnabled,true);
 assert.equal(granted.revision,3);
 const remote=await continuityRequest('remoteBrief',{projectId:project.id},{root});
 assert.match(remote.content,/Owner-approved note/);
 response=await post(password,{'x-light-remote-csrf':csrf});assert.equal(response.status,403); // stale revision
 const expiredProof=signContinuityConsent({root,signerDir,projectId:project.id,enabled:true,revision:3,principal:'owner',now:Date.now()-180000});
 await assert.rejects(continuityRequest('applySignedOwnerConsent',{projectId:project.id,proof:expiredProof},{root}),/continuity_owner_grant_expired/);
 // Dedicated owner step-up is required to revoke. Use updated revision.
 response=await fetch(origin+'/api/project-continuity/setRemoteReadConsent',{method:'POST',
  headers:{cookie,'content-type':'application/json','x-light-remote-csrf':csrf},
  body:JSON.stringify({projectId:project.id,enabled:false,expectedRevision:3,password})});
 assert.equal(response.status,200);
 await assert.rejects(continuityRequest('remoteBrief',{projectId:project.id},{root}),/continuity_remote_read_denied/);
 const after=await continuityRequest('getProject',{projectId:project.id},{root});
 assert.equal(after.remote_read_enabled,0);
 assert.equal(after.revision,4);
 // Revocation is durable after service restart and cannot be undone by replay.
 await wall.close();wall=null;
 await service.stop();service=null;
 service=startContinuityServer({root});await once(service.server,'listening');
 await assert.rejects(continuityRequest('remoteBrief',{projectId:project.id},{root}),/continuity_remote_read_denied/);
 const replay=signContinuityConsent({root,signerDir,projectId:project.id,enabled:true,revision:2,principal:'owner'});
 await assert.rejects(continuityRequest('applySignedOwnerConsent',{projectId:project.id,proof:replay},{root}),/continuity_stale_revision/);
 assert.equal((await continuityRequest('getProject',{projectId:project.id},{root})).remote_read_enabled,0);
 console.log('P2_OWNER_SIGNED_30S_SCOPE_AND_REPLAY_DENY_PASS');
 console.log('P2_LOCAL_WALL_PASSWORD_CSRF_CONSENT_REVOKE_PASS');
 console.log('P2_REMOTE_CONSENT_RESTART_FAIL_CLOSED_PASS');
}finally{
 try{await wall?.close();}catch{}
 try{await service?.stop();}catch{}
 fs.rmSync(root,{recursive:true,force:true});
}
