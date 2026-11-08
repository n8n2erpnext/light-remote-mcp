import assert from 'node:assert/strict';
import {handlePluginRoutes} from '../../operator-host/executor-routes-plugin.mjs';
const acc='acct_alpha',deviceId='dev_win11';
let reads=0;
class SecurityError extends Error{constructor(message,status=403){super(message);this.status=status}}
const deps={
 accounts:{account(id){if(id!==acc)throw new SecurityError('account_not_found');return {accountId:acc};}},
 agentClients:{resolve(clientId,{agentId,deviceId:did,touch}){
   if(clientId!=='lrc_valid'||agentId!=='agent_valid'||did!==deviceId||touch!==false)
     throw new SecurityError('agent_client_device_not_authorized');
   return {clientSessionId:clientId,deviceId:did,accountId:acc,agentId};
 }},
 devices:{get(id){if(id!==deviceId)throw new SecurityError('device_not_found',404);
   return {deviceId:id,accountId:acc,state:'online'};}},
 deviceBootObservations:{async inspect({accountId,deviceId:id}){
   assert.equal(accountId,acc);assert.equal(id,deviceId);reads++;
   return {state:'reported',releaseEligible:false,evidence:{nativeConsistency:'consistent'}};}},
 sendJson(res,status,data){res.status=status;res.data=data;return data},
 AccountError:SecurityError,
};
const target=(account,device,client='lrc_valid',agent='agent_valid')=>
 new URL(`http://localhost/v1/plugin/accounts/${account}/devices/${device}/boot-evidence?agentId=${agent}&clientSessionId=${client}`);
const test=async(url,d=deps)=>handlePluginRoutes({method:'GET'}, {},url,d);
const good=await test(target(acc,deviceId));
assert.equal(good.releaseEligible,false);
assert.equal(good.recoveryAuthorization,'not_authorized_by_boot_telemetry');
assert.equal(good.evidence.nativeConsistency,'consistent');
assert.equal(reads,1);
await assert.rejects(()=>test(target('acct_beta',deviceId)),/account_not_found/);
await assert.rejects(()=>test(target(acc,deviceId,'lrc_invalid')),/agent_client_device_not_authorized/);
await assert.rejects(()=>test(target(acc,'dev_other')),/agent_client_device_not_authorized/);
await assert.rejects(()=>test(target(acc,deviceId,'lrc_valid','agent_spoof')),/agent_client_device_not_authorized/);
await assert.rejects(()=>test(target(acc,deviceId),{
  ...deps,devices:{get(){return {deviceId,accountId:'acct_beta',state:'online'}}}
}),/plugin_boot_device_scope_denied/);
await assert.rejects(()=>test(target(acc,deviceId),{
  ...deps,devices:{get(){return {deviceId,accountId:acc,state:'revoked'}}}
}),/plugin_boot_device_scope_denied/);
assert.equal(reads,1,'cross account or stale authorization must never reach telemetry store');
console.log('GOLD_BOOT_PLUGIN_A_B_SCOPED_OWNER_READ_ONLY_NO_M4_PASS');
