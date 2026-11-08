import assert from 'node:assert/strict';
import test from 'node:test';
import {loadCanonicalEndpoints,canonicalRoute} from './canonical-endpoints.mjs';
import {API_CONTRACT_VERSION,apiPath,apiRoute,assertApiVersion} from './api-contract.mjs';
import {registerDesktopOwnerTokenRoutes} from '../plugin-server/desktop-owner-token-v4.mjs';
test('one reviewed endpoint catalog supplies real public token registration and read gate',()=>{
 const registered=[];
 const app={post(path,handler){registered.push({method:'POST',path,handler});},get(path,handler){registered.push({method:'GET',path,handler});}};
 const redis={get:async()=>null,set:async()=>{},getDel:async()=>null,del:async()=>0};
 assert.equal(registerDesktopOwnerTokenRoutes(app,{enabled:false}).routes,0);
 assert.deepEqual(registered,[]);
 const result=registerDesktopOwnerTokenRoutes(app,{enabled:true,readEnabled:true,prefix:'lr:gold:unified_test:',redis,consumeCode:async()=>null});
 assert.equal(result.routes,5);
 for(const name of ['ownerToken','ownerRefresh','ownerSession','ownerLogout','ownerSnapshot']){
  const row=apiRoute(name);assert(registered.some(r=>r.path===row.path&&r.method===row.method&&typeof r.handler==='function'));
 }
 assert.equal(apiPath('operatorOwnerSnapshot'),'/v1/accounts/desktop-v4/snapshot');
});
test('contract negotiation rejects absent/old versions, and unknown routes are closed',()=>{
 assert.equal(assertApiVersion(API_CONTRACT_VERSION),true);
 for(const value of [undefined,null,'','light-remote.api.v0'])assert.throws(()=>assertApiVersion(value),/contract_mismatch/);
 assert.throws(()=>apiPath('arbitraryUrl'),/unknown_route/);
 assert(Object.isFrozen(apiRoute('ownerSnapshot')));
});

test('private Operator transport is never exposed as a public/browser URL',()=>{
 const catalog=loadCanonicalEndpoints(new URL('../config/endpoints.json',import.meta.url));
 assert.equal(apiRoute('operatorOwnerSnapshot').transport,'private-unix');
 assert.throws(()=>canonicalRoute(catalog,'operatorOwnerSnapshot'),/route_unknown/);
});
