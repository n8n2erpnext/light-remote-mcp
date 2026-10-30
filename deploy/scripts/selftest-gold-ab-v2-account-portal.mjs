// P2-I2e: portal source-only owner cookie -> Operator session proxy contract.
import assert from 'node:assert/strict';
import {createGoldAbV2AccountPortalProxy,isGoldAbV2PortalAction}
 from '../../plugin-server/account-ab-v2.mjs';
const origin='https://gold.example.test';
const token='account-cookie-session-12345678901234567890';
const requestId='av2_'+'a'.repeat(32);
const csrf='B'.repeat(43);
const calls=[];
const toOperator=async(method,target,body,headers)=>{
 calls.push({method,target,body,headers});
 return {ok:true,pending:[{requestId,state:'pending',aCode:'ABCD02-GHFDX'}]};
};
const makeRes=()=>({
 status(s){this.statusCode=s;return this},
 set(k,v){this.headers={...this.headers,[k]:v};return this},
 json(x){this.payload=x;return this}
});
const makeReq=(method='GET',query={},body={},headers={})=>({
 method,query,body,headers:{'x-caller-cookie':'yes',...headers}});
const proxy=createGoldAbV2AccountPortalProxy({enabled:true,publicOrigin:origin,
 sessionToken:()=>token,callOperatorJson:toOperator});
async function invoke(action,req){const res=makeRes();await proxy(req,res,action);return res;}
assert.equal(isGoldAbV2PortalAction('abv2-pending'),true);
assert.equal(isGoldAbV2PortalAction('abv2-approve'),true);
const defaultOff=await invoke('abv2-approve',makeReq('POST',{},
 {deviceId:'dev1',requestId,expectedAttempt:1,bCode:'ABCD-2345'},
 {origin,'x-light-abv2-csrf':csrf}));
assert.equal(defaultOff.statusCode,404,'new B owner proxy stays OFF without explicit gate');
const list=await invoke('abv2-pending',makeReq('GET',{deviceId:'dev1',accountId:'evil',clientId:'fake'}));
assert.equal(list.statusCode,200);assert.equal(list.headers['Cache-Control'],'no-store');
assert.deepEqual(calls.at(-1),{method:'GET',target:'/v1/accounts/ab-v2/devices/dev1/pending',body:null,
 headers:{'x-light-account-session':token}});
const cs=await invoke('abv2-csrf',makeReq('GET',{deviceId:'dev1'}));
assert.equal(cs.statusCode,200);
assert.equal(calls.at(-1).target,'/v1/accounts/ab-v2/devices/dev1/csrf');
const detail=await invoke('abv2-view',makeReq('GET',{deviceId:'dev1',requestId}));
assert.equal(detail.statusCode,200);
assert.ok(calls.at(-1).target.endsWith(requestId));
const refresh=await invoke('abv2-refresh',makeReq('POST',{},{
 deviceId:'dev1',requestId,expectedAttempt:2,actorAccountId:'spoof',ownerAccountId:'evil',
 agentId:'fake',connectionId:'guess',bCode:'SECRET'},
 {origin,'x-light-abv2-csrf':csrf}));
assert.equal(refresh.statusCode,200);
assert.equal(calls.at(-1).method,'POST');
assert.deepEqual(calls.at(-1).body,{expectedAttempt:2});
assert.deepEqual(calls.at(-1).headers,{'x-light-account-session':token,
 origin,'sec-fetch-site':'same-origin','x-light-abv2-csrf':csrf});
const deny=await invoke('abv2-deny',makeReq('POST',{},{
 deviceId:'dev1',requestId,expectedAttempt:999,bCode:'SECRET'
},{origin,'x-light-abv2-csrf':csrf}));
assert.equal(deny.statusCode,200);
assert.deepEqual(calls.at(-1).body,{});
const before=calls.length;
for(const [action,request,code] of [
 ['abv2-refresh',makeReq('POST',{}, {deviceId:'dev1',requestId,expectedAttempt:1},{'x-light-abv2-csrf':csrf}),403],
 ['abv2-deny',makeReq('POST',{}, {deviceId:'dev1',requestId},{origin:'https://evil.test','x-light-abv2-csrf':csrf}),403],
 ['abv2-deny',makeReq('POST',{}, {deviceId:'dev1',requestId},{origin,'x-light-abv2-csrf':'invalid'}),403],
 ['abv2-refresh',makeReq('POST',{}, {deviceId:'dev1',requestId,expectedAttempt:'1'},{origin,'x-light-abv2-csrf':csrf}),400],
 ['abv2-deny',makeReq('POST',{}, {deviceId:'../../dev2',requestId},{origin,'x-light-abv2-csrf':csrf}),400],
 ['abv2-view',makeReq('GET',{deviceId:'dev1',requestId:'arbitrary'}),400],
 ['abv2-refresh',makeReq('GET',{deviceId:'dev1',requestId}),405],
 ])assert.equal((await invoke(action,request)).statusCode,code,action);
assert.equal(calls.length,before,'denied requests never forwarded');
const noSession=createGoldAbV2AccountPortalProxy({enabled:true,publicOrigin:origin,
 sessionToken:()=>'',callOperatorJson:toOperator});
const noSessionRes=makeRes();
await noSession(makeReq('GET',{deviceId:'dev1'}),noSessionRes,'abv2-pending');
assert.equal(noSessionRes.statusCode,401);
const off=createGoldAbV2AccountPortalProxy({enabled:false,publicOrigin:'http://localhost',
 sessionToken:()=>token,callOperatorJson:toOperator});
const offRes=makeRes();
await off(makeReq('GET',{deviceId:'dev1'}),offRes,'abv2-pending');
assert.equal(offRes.statusCode,404);
assert.equal(calls.length,before,'off cannot proxy');
assert.equal(await off(makeReq(),makeRes(),'unknown-action'),false);
const enabledApproval=createGoldAbV2AccountPortalProxy({enabled:true,approveEnabled:true,
 publicOrigin:origin,sessionToken:()=>token,callOperatorJson:toOperator});
const approvalList=makeRes();
await enabledApproval(makeReq('GET',{deviceId:'dev1'}),approvalList,'abv2-pending');
assert.equal(approvalList.payload.ownerApproveEnabled,true);
const approvalReq=makeReq('POST',{}, {deviceId:'dev1',requestId,
 expectedAttempt:2,bCode:'ABCD-2345',agentId:'spoof',accountId:'spoof',connectionId:'spoof'},
 {origin,'x-light-abv2-csrf':csrf});
const approvalRes=makeRes();
await enabledApproval(approvalReq,approvalRes,'abv2-approve');
assert.equal(approvalRes.statusCode,200);
assert.deepEqual(calls.at(-1).body,{expectedAttempt:2,bCode:'ABCD-2345'});
assert.equal(calls.at(-1).target,
 '/v1/accounts/ab-v2/devices/dev1/pending/'+requestId+'/approve');
const invalidB=makeRes();
await enabledApproval(makeReq('POST',{}, {deviceId:'dev1',requestId,
 expectedAttempt:2,bCode:'BAD1-0000'},{origin,'x-light-abv2-csrf':csrf}),
 invalidB,'abv2-approve');
assert.equal(invalidB.statusCode,400);
const invalidOrigin=makeRes();
await enabledApproval(makeReq('POST',{}, {deviceId:'dev1',requestId,
 expectedAttempt:2,bCode:'ABCD-2345'},{origin:'https://evil.test',
 'x-light-abv2-csrf':csrf}),invalidOrigin,'abv2-approve');
assert.equal(invalidOrigin.statusCode,403);
import fs from 'node:fs';
const portal=fs.readFileSync(new URL('../../plugin-server/account-portal/index.html',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../../plugin-server/account-portal/ab-v2.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../../plugin-server/account-portal.mjs',import.meta.url),'utf8');
assert.match(portal,/id="abv2Panel" hidden style="display:none"/);
assert.match(portal,/src="\/account\/assets\/ab-v2\.js"/);
assert.match(ui,/panel\.hidden=false;panel\.style\.display='';/);
assert.match(router,/app\.get\('\/account\/assets\/ab-v2\.js'/);
assert.match(router,/if\(isGoldAbV2PortalAction\(action\)\)/);
assert.match(ui,/data\.ownerApproveEnabled===true/,'B input stays hidden unless owner approval is explicitly enabled');
assert.match(ui,/response\.state!=='granted'/,'must require durable grant state');
assert.ok(!ui.includes('localStorage'),'B must not be persisted in browser storage');
assert.ok(!ui.includes('response.bCode'),'never display Agent-only B from server');
console.log('GOLD_ABV2_ACCOUNT_UI_DEFAULT_HIDDEN_OWNER_B_OPT_IN=PASS');
console.log('GOLD_ABV2_ACCOUNT_COOKIE_PROXY_ORIGIN_CSRF_GATED_B_APPROVE=PASS');
