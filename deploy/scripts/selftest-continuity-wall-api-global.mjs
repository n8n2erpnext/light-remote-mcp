/* Loopback-only route-contract unit test, NOT a second product Wall or UAT deployment. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {provisionContinuityOwnerAuthority,signContinuityConsent} from '../../device-agent/project-continuity-owner-grants.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig,LOCAL_WALL_COOKIE} from '../../device-agent/local-wall-auth.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-shared-wall-contract-'));
const store=new ContinuityStore({root:path.join(root,'state')});
let wall;
try{
 const old=store.moduleSettings();
 const next=store.setGlobalModules({memory:true,codex:false,expectedRevision:old.revision});
 store.observeGoldTool({operationId:'command:local-test-123456',category:'search',outcome:'ok'});
 const signerDir=path.join(root,'owner-signing');
 const ownerPassword='owner-private-test-password-123';
 provisionContinuityOwnerAuthority({root:store.root,signerDir,password:ownerPassword});
 const authFile=path.join(root,'login.json');
 writeLocalWallAuthConfig(authFile,{username:'owner-test',password:ownerPassword});
 const auth=loadLocalWallAuth(authFile,{required:true});
 const actions={
  getGlobalModules:()=>store.moduleSettings(),
  getProject:d=>store.project(d.projectId),
  remoteWriteStatus:d=>store.remoteWriteStatus(d.projectId),
  recentGoldActivity:d=>store.recentGoldActivity({limit:d.limit??12})
 };
 wall=startLocalWall({
  host:'127.0.0.1',port:0,
  brandSvgPath:path.join(process.cwd(),'assets/branding/light-remote-mark.svg'),
  auth,
  getLocalStatus:()=>({cloudState:'dormant',enrolled:false}),
  continuity:{
   request:async(a,d)=>{if(!(a in actions))throw Error('unsupported_in_this_route_test');return actions[a](d);},
   ownerConsent:async({principal,password,projectId,enabled,expectedRevision,scope='read'})=>{
    if(!auth.verifyCredentials(principal,password))throw Error('invalid_owner_credentials');
    if(scope!=='write')throw Error('unexpected_read_action');
    const proof=signContinuityConsent({root:store.root,signerDir,password,projectId,enabled,
     revision:expectedRevision,principal,scope:'write'});
    return store.setRemoteWriteConsent(projectId,{proof});
   }
  }
 });
 await once(wall.server,'listening');
 const url='http://127.0.0.1:'+wall.server.address().port;
 const token=auth.issue('owner-test').token,cookie=LOCAL_WALL_COOKIE+'='+token;
 const csrf=auth.csrfForRequest({headers:{cookie}});
 const get=(p,headers={})=>fetch(url+p,{headers,redirect:'manual'});
 let resp=await get('/api/project-continuity/getGlobalModules');
 assert.equal(resp.status,401);
 resp=await get('/projects',{cookie});assert.equal(resp.status,200);
 const html=await resp.text();
 assert.ok(html.includes('Long Memory')&&html.includes('Codex Bridge'));
 assert.ok(html.includes('globalConsentForm')&&html.includes('globalCodexArea'));
 assert.ok(html.includes('globalWriteConsentForm'));
 const request=async(a,data,csrfHeader=csrf)=>fetch(url+'/api/project-continuity/'+a,{
  method:'POST',headers:{cookie,'content-type':'application/json','x-light-remote-csrf':csrfHeader},
  body:JSON.stringify(data)
 });
 resp=await request('getProject',{projectId:next.defaultScopeId},'bad');
 assert.equal(resp.status,403);
 resp=await request('getProject',{projectId:next.defaultScopeId});
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).result.memory_enabled,1);
 resp=await request('recentGoldActivity',{limit:12});
 assert.equal(resp.status,200);
 const rows=(await resp.json()).result;
 assert.equal(rows[0].category,'search');
 resp=await request('remoteWriteStatus',{projectId:next.defaultScopeId});
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).result.enabled,false);
 let params={projectId:next.defaultScopeId,enabled:true,expectedRevision:1,password:ownerPassword};
 resp=await request('setRemoteWriteConsent',params,'bad');
 assert.equal(resp.status,403);
 resp=await request('setRemoteWriteConsent',{...params,password:'wrong-secret'});
 assert.equal(resp.status,403);
 resp=await request('setRemoteWriteConsent',params);
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).result.remoteWriteEnabled,true);
 params={...params,enabled:false,expectedRevision:2};
 resp=await request('setRemoteWriteConsent',params);
 assert.equal(resp.status,200);
 assert.equal((await resp.json()).result.remoteWriteEnabled,false);
 resp=await get('/',{cookie});
 assert.equal(resp.status,200);
 assert.ok((await resp.text()).includes('Continuity'));
 console.log('SAME_GOLD_WALL_GLOBAL_MEMORY_DEFAULT_SCOPE_AND_ACTIVITY_API_PASS');
 console.log('SAME_GOLD_WALL_OWNER_AUTH_CSRF_NO_PROJECT_ROUTE_PASS');
 console.log('SAME_GOLD_WALL_SEPARATE_SIGNED_REMOTE_WRITE_STEPUP_REVOKE_PASS');
}finally{await wall?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
