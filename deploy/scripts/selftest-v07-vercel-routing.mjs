import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const operatorLib=require('../../lib/operator');
const calls=[];
operatorLib.callOperator=async (path,options={})=>{calls.push({kind:'call',path,options});if(path.includes('/begin'))return{enrollment:{enrollmentId:'enr_12345678-1234-1234-1234-123456789abc'}};if(path.includes('/poll'))return{enrollment:{state:'pending'}};if(path.includes('/heartbeat'))return{device:{deviceId:'dev_1234567890abcdef12345678',state:'online'}};if(path.includes('/revoke'))return{device:{deviceId:'dev_1234567890abcdef12345678',state:'revoked'}};if(path.includes('/approve'))return{approval:{deviceId:'dev_1234567890abcdef12345678'}};return{pending:[]};};
operatorLib.execOperator=async()=>({});
const handler=require('../../api/operator');
function response(){return{statusCode:200,body:null,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
async function invoke(body,headers={}){const res=response();await handler({method:'POST',body,query:{},headers},res);if(res.statusCode!==200)throw new Error(`route_failed:${body.action}:${res.statusCode}:${res.body?.error}`);return res.body;}
const pub='MCowBQYDK2VwAyEA'+Buffer.alloc(32,1).toString('base64');
await invoke({action:'enrollment-begin',payload:{publicIdentityKey:pub,displayName:'test',platform:'linux',architecture:'x64',agentVersion:'0.7',capabilities:['git'],policyProfile:'default'}},{'x-forwarded-for':'203.0.113.44'});
await invoke({action:'enrollment-poll',payload:{enrollmentId:'enr_12345678-1234-1234-1234-123456789abc',pollToken:'a'.repeat(43)}});
await invoke({action:'device-heartbeat',payload:{deviceId:'dev_1234567890abcdef12345678',timestamp:Date.now(),nonce:'n'.repeat(20),signature:'s'.repeat(86),capabilities:['git']}});
await invoke({action:'enrollment-approve',payload:{code:'ABCD-EFGH',approvedCapabilities:['git'],policyProfile:'default'}},{'x-bridge-session':'bridge-session-test'});
await invoke({action:'device-revoke',payload:{deviceId:'dev_1234567890abcdef12345678',reason:'test-cleanup'}},{'x-bridge-session':'bridge-session-test'});
const begin=calls.find(c=>c.path==='/operator/enrollments/begin');const poll=calls.find(c=>c.path==='/operator/enrollments/poll');const hb=calls.find(c=>c.path.includes('/heartbeat'));const approve=calls.find(c=>c.path==='/operator/enrollments/approve');const revoke=calls.find(c=>c.path.includes('/revoke'));
if(!begin||begin.options.bridgeSession!=='')throw new Error('public_begin_forwarding_failed');
if(!/^[a-f0-9]{64}$/.test(begin.options.body?.sourceHash||'')||JSON.stringify(begin.options.body).includes('203.0.113.44'))throw new Error('enrollment_source_hash_failed');
if(!poll||poll.options.bridgeSession!=='')throw new Error('public_poll_forwarding_failed');
if(!hb||hb.options.bridgeSession!=='')throw new Error('public_heartbeat_forwarding_failed');
if(approve?.options.bridgeSession!=='bridge-session-test'||revoke?.options.bridgeSession!=='bridge-session-test')throw new Error('owner_bridge_session_not_forwarded');
console.log('v07-vercel-public-enrollment-forwarding=PASS');
console.log('v07-enrollment-source-hash=PASS');
console.log('v07-vercel-owner-approval-forwarding=PASS');
