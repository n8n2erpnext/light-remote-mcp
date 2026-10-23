import assert from 'node:assert/strict';
import {GoldNativeAccountDevice} from '../../lib/gold-native-account-device.mjs';
import {handleAccountRoutes} from '../../operator-host/executor-routes-account.mjs';

const fk={schema_name:'public',relation_name:'lr_device_connections',column_name:'device_id'};
function nativeFixture({linked=false,queryFailure=false}={}){
 const queries=[];
 const pool={connect:()=>{},query:async(sql,args)=>{
  queries.push({sql,args});
  if(queryFailure)throw Error('permission_denied_for_fk_catalog');
  if(sql.includes('FROM pg_constraint'))return {rows:[fk]};
  assert(sql.includes('SELECT EXISTS'), 'must check references using read-only SQL');
  assert.deepEqual(args,['dev_target']);
  return {rows:[{referenced:linked}]};
 }};
 return {store:new GoldNativeAccountDevice({pool,accounts:[],devices:[]}),queries};
}
{
 const x=nativeFixture({linked:true});
 assert.equal(await x.store.deviceHasHistoricalReferences('dev_target'),true);
 assert.equal(x.queries.length,2);
 assert(!x.queries.some(z=>/\bDELETE\b|\bUPDATE\b|\bINSERT\b/i.test(z.sql)));
}
{
 const x=nativeFixture({linked:false});
 assert.equal(await x.store.deviceHasHistoricalReferences('dev_target'),false);
}
{
 const x=nativeFixture({queryFailure:true});
 await assert.rejects(()=>x.store.deviceHasHistoricalReferences('dev_target'),/permission_denied/);
}
class AccountError extends Error{constructor(message,status=400){super(message);this.status=status}}
const route='http://operator.local/v1/plugin/accounts/acct_owner/devices/dev_target/remove';
function routeFixture({linked=true,preflight=true}={}){
 const activity=[];
 const deps={
  AccountError,DEVICE_ID:'hub_other',
  accounts:{assertOperational:(id)=>assert.equal(id,'acct_owner'),account:()=>({accountId:'acct_owner'})},
  devices:{get:()=>({deviceId:'dev_target',accountId:'acct_owner'}),
    remove:()=>{activity.push('remove_device');return {removed:true};}},
  clearMainIfMatches:()=>{activity.push('clear_main');return null;},
  removeRuntimeForDevice:()=>{activity.push('remove_runtime');},
  enrollments:{remove:()=>{activity.push('remove_enrollment');return {removed:true};}},
  wakeDeviceChannelForDevice:()=>{activity.push('wake_channel');},
  readJson:async()=>({reason:'owner_requested'}),
  sendJson:(res,status,json)=>{res.status=status;res.body=json;return json},
  planEntitlements:()=>({})
 };
 if(preflight)deps.deviceHasHistoricalReferences=async()=>{activity.push('check_fk');return linked};
 return {deps,activity};
}
{
 const t=routeFixture({linked:true}),res={};
 await assert.rejects(()=>handleAccountRoutes({method:'POST'},res,new URL(route),t.deps),e=>{
  assert.equal(e.status,409);assert.equal(e.message,'device_has_referenced_history_revoke_instead');return true;
 });
 assert.deepEqual(t.activity,['check_fk'],'reject before ANY Device, enrollment or session mutation');
}
{
 const t=routeFixture({preflight:false}),res={};
 await assert.rejects(()=>handleAccountRoutes({method:'POST'},res,new URL(route),t.deps),e=>e.status===503);
 assert.deepEqual(t.activity,[]);
}
{
 const t=routeFixture({linked:false}),res={};
 const result=await handleAccountRoutes({method:'POST'},res,new URL(route),t.deps);
 assert.equal(res.status,200);assert.equal(result.removed.removed,true);
 assert.deepEqual(t.activity,['check_fk','clear_main','remove_runtime','remove_enrollment','remove_device','wake_channel']);
}
console.log('GOLD_NATIVE_DEVICE_FK_PREFLIGHT_PASS historical_fk_409,read_only_catalog,fail_closed,mutation_order,clean_removal');