/* Loopback-only route-contract unit test, NOT a second product Wall or UAT deployment. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {ContinuityStore} from '../../device-agent/project-continuity-store.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig,LOCAL_WALL_COOKIE} from '../../device-agent/local-wall-auth.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-shared-wall-contract-'));
const store=new ContinuityStore({root:path.join(root,'state')});
let wall;
try{
 const old=store.moduleSettings();
 const next=store.setGlobalModules({memory:true,codex:false,expectedRevision:old.revision});
 store.observeGoldTool({operationId:'command:local-test-123456',category:'search',outcome:'ok'});
 const authFile=path.join(root,'login.json');
 writeLocalWallAuthConfig(authFile,{username:'owner-test',password:'owner-private-test-password-123'});
 const auth=loadLocalWallAuth(authFile,{required:true});
 const actions={
  getGlobalModules:()=>store.moduleSettings(),
  getProject:d=>store.project(d.projectId),
  recentGoldActivity:d=>store.recentGoldActivity({limit:d.limit??12})
 };
 wall=startLocalWall({
  host:'127.0.0.1',port:0,
  brandSvgPath:path.join(process.cwd(),'assets/branding/light-remote-mark.svg'),
  auth,
  getLocalStatus:()=>({cloudState:'dormant',enrolled:false}),
  continuity:{request:async(a,d)=>{if(!(a in actions))throw Error('unsupported_in_this_route_test');return actions[a](d);}}
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
 resp=await get('/',{cookie});
 assert.equal(resp.status,200);
 assert.ok((await resp.text()).includes('Continuity'));
 console.log('SAME_GOLD_WALL_GLOBAL_MEMORY_DEFAULT_SCOPE_AND_ACTIVITY_API_PASS');
 console.log('SAME_GOLD_WALL_OWNER_AUTH_CSRF_NO_PROJECT_ROUTE_PASS');
}finally{await wall?.close();store.close();fs.rmSync(root,{recursive:true,force:true});}
