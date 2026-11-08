// Source-level compatibility guard. No live Operator calls or npm install.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AccountOperatorAdapter} from '../../plugin-server/operator-adapter.mjs';
const adapter=fs.readFileSync(new URL('../../plugin-server/operator-adapter.mjs',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../../plugin-server/tools.mjs',import.meta.url),'utf8');
const must=(body,value)=>assert.ok(body.includes(value),'Missing source contract: '+value);
must(adapter,'signGoldAbV2HelperTarget({identity:this.identity,targetQuery,');
must(adapter,'/v1/plugin/abv2/target-resolve');
must(adapter,'/v1/plugin/pro-share/target-resolve');
must(adapter,'/v1/plugin/abv2/request-issue');
must(adapter,'/v1/plugin/pro-share/request-issue');
must(adapter,'LR_GOLD_AB_V2_HELPER_TARGET_QUERY');
must(adapter,'LR_GOLD_PRO_SHARE_GUEST_AB_TARGET_QUERY');
must(adapter,'LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE');
must(adapter,'LR_GOLD_PRO_SHARE_GUEST_AB_REQUEST_ISSUE');
must(adapter,'status:\'target_resolution_unavailable\'');
must(adapter,'helperReady:false,approvalState:\'not_issued\'');
must(adapter,'async issueAbV2Request(targetQuery,{requestKey=null,guestShare=false}={})');
must(adapter,'async pollAbV2Request({requestId,deviceId,shortId,guestShare=false}={})');
must(adapter,'LR_GOLD_PRO_SHARE_GUEST_AB_POLL');
must(adapter,'/v1/plugin/pro-share/request-poll');
must(adapter,'LR_GOLD_AB_V2_HELPER_POLL_ATTACH');
must(adapter,"result.status!=='ready'||result.helperReady!==true");
must(source,'targetQuery:z.string().min(1).max(120).optional()');
must(source,'aCode:z.string().regex');
must(source,'continuation:z.string().min(20).max(8192).optional()');
must(source,'startAbV2:z.boolean().optional()');
must(source,'guestShare:z.boolean().optional()');
must(source,'requestKey:z.string().regex');
must(source,'abv2_helper_target_query_conflict');
must(source,'if(x.targetQuery){');
must(source,'a.discoverAbV2Devices({');
must(source,"if(labV2Only){");
must(source,"'device_discovery_unavailable_refresh_plugin_metadata'");
must(source,'if(v2){');
must(source,'a.issueAbV2Request(x.targetQuery,{requestKey:x.requestKey||null,');
must(source,'guestShare:x.guestShare===true');
must(source,'pollRequestId:z.string().regex');
must(source,'pollDeviceId:id.optional()');
must(source,'pollShortId:z.string().regex');
must(source,'a.pollAbV2Request({requestId:x.pollRequestId');
assert.ok(!source.includes('if(x.targetQuery)return a.pairBegin'),
 'a name search must not silently choose or start V1 A-code pairing');
console.log('GOLD_ABV2_AND_GUEST_MCP_HELPER_OPTIONAL_V1_DEFAULT_OFF=PASS');
console.log('GOLD_ABV2_MCP_HELPER_POLL_V1_UNCHANGED=PASS');

// Dynamic candidate test: Lab V2 ready onboarding MUST NOT tell Owner to copy A.
// Production/V1 onboarding must remain unchanged.
const envKeys=['LR_GOLD_INSTANCE_ID','LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1'];
const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
try {
 const a=new AccountOperatorAdapter({accountId:'acct1',clientId:'fixture-oauth'});
 a.accountRaw=async()=>({plan:'vip',mainDeviceId:null});
 a.clientRaw=async()=>({clientSessionId:'lrc_fixture'});
 a.authorizedDeviceDetails=async()=>[{
  deviceId:'dev1',displayName:'Lab',state:'online',
  platform:'linux',architecture:'arm64',effectiveCapabilities:['filesystem']
 }];
 a.workingContext=async({agentNickname=null}={})=>({context:{deviceId:'dev1',sessionId:'s_fixture'},
   session:{deviceId:'dev1',sessionId:'s_fixture',state:'active',
     displayName:agentNickname,nameSource:agentNickname?'agent':null}});
 process.env.LR_GOLD_INSTANCE_ID='abv2lab01';
 process.env.LR_GOLD_ABV2_LAB_DISABLE_LEGACY_V1='1';
 const lab=await a.connectionHelper();
 assert.equal(lab.status,'ready');
 assert.match(lab.onboarding.normalFlow.join(' '),/Owner enters B/);
 assert.doesNotMatch(lab.onboarding.normalFlow.join(' '),/copy the one-time A code/);
 assert.equal(lab.governance.deviceAuthorization,'agent-initiated-abv2-local-wall-or-account-b');
 assert.equal(lab.sessionId,'s_fixture');
 assert.equal(lab.sessionNickname,null,'optional nickname omission cannot block ready');
 const named=await a.connectionHelper(null,{agentNickname:'Claude Curious Otter'});
 assert.equal(named.status,'ready');
 assert.equal(named.sessionId,'s_fixture');
 assert.equal(named.sessionNickname,'Claude Curious Otter');
 assert.equal(named.nicknameSource,'agent');
 process.env.LR_GOLD_INSTANCE_ID='production';
 const prod=await a.connectionHelper();
 assert.match(prod.onboarding.normalFlow.join(' '),/copy the one-time A code/);
 assert.equal(prod.governance.deviceAuthorization,'local-wall-a-b');
 console.log('GOLD_ABV2_LAB_HELPER_ONBOARDING_V2_NOT_LEGACY_COPY_A=PASS');
 console.log('GOLD_V1_HELPER_ONBOARDING_PRESERVED=PASS');
}finally{
 for(const [k,v] of Object.entries(originalEnv)){
  if(v==null)delete process.env[k];else process.env[k]=v;
 }
}
