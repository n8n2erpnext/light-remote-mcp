import assert from 'node:assert/strict';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';
import {resourcePathsOverlap} from '../../operator-host/device-resource-intent.mjs';
const pair=(a,b)=>resourcePathsOverlap(a,b);
for(const k of ['file-dir:c:/windows/temp','project:c:/users/example','file-dir:/tmp/test','project:/work/b']){
 assert.equal(pair('project:unknown',k),true,`unknown writer must conflict with ${k}`);
 assert.equal(pair(k,'project:unknown'),true,`symmetric conflict with ${k}`);
}
assert.equal(pair('file-dir:c:/windows/temp','project:c:/users/example'),false);
async function admission(existingKey,newKey,mode='exclusive'){
 const statements=[];
 const client={query:async(sql,args)=>{
  statements.push({sql,args});
  if(sql.includes('FROM lr_gold_device_resource_claims'))return {rows:[{resource_key:existingKey,resource_mode:'exclusive',worker_weight:1}]};
  return {rows:[],rowCount:1};
 }};
 const r=await new GoldDeviceResourceLocks({capacity:2}).tryClaim(client,{
  job_id:'11111111-1111-4111-8111-111111111111',account_id:'fixture_owner',
  device_id:'fixture_dev',resource_key:newKey,resource_mode:mode,worker_weight:1
 });
 return {r,inserted:statements.some(s=>s.sql.startsWith('INSERT INTO lr_gold_device_resource_claims'))};
}
for(const [oldKey,nextKey] of [
 ['project:unknown','file-dir:c:/windows/temp'],
 ['file-dir:c:/windows/temp','project:unknown'],
 ['project:unknown','project:/work/b'],
 ]){const {r,inserted}=await admission(oldKey,nextKey);
  assert.deepEqual(r,{granted:false,reason:'RESOURCE_LOCKED'});
  assert.equal(inserted,false,'no conflicting claim insert');
}
const different=await admission('project:c:/users/example','file-dir:c:/windows/temp');
assert.deepEqual(different.r,{granted:true,reason:null});
assert.equal(different.inserted,true,'nonoverlapping known scope can proceed');
console.log('P0_M4_UNKNOWN_WORKSPACE_DEVICE_WIDE_WRITE_CONFLICT_FAIL_CLOSED_PASS');
