import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
const runtimeFiles=['lib/http.js','api/operator.js','api/guide.js'];
const currentGuides=['README.md','AI_BRIDGE_GUIDE.md','DEVICE_PRESENCE_V0_6.md'];
const forbidden=[/VPS_BRIDGE_CALLER_SECRET/,/bridge_caller_auth_required/,/requireBridgeCaller/,/isBridgeCallerAuthorized/];
for(const rel of [...runtimeFiles,...currentGuides]){
  const text=fs.readFileSync(path.join(root,rel),'utf8');
  for(const pattern of forbidden) if(pattern.test(text)) throw new Error(`static_bearer_reference:${rel}:${pattern}`);
}
if(fs.existsSync(path.join(root,'lib/caller-auth.js'))) throw new Error('caller_auth_module_still_present');
if(fs.existsSync(path.join(root,'deploy/scripts/selftest-bridge-caller-auth.mjs'))) throw new Error('legacy_bearer_test_still_present');
const guide=fs.readFileSync(path.join(root,'api/guide.js'),'utf8');
if(!/staticSharedBearer\s*:\s*false/.test(guide)) throw new Error('guide_missing_static_bearer_false_contract');
if(!/no static shared Bearer/i.test(guide)) throw new Error('guide_missing_no_static_bearer_security_text');

const operatorLib=require('../../lib/operator');
const mcpLib=require('../../lib/mcp');
function upstreamAuth(options={}){
  if(options.bridgeSession) return;
  const error=new Error('operator_http_401'); error.status=401; error.payload={error:'bridge_session_required'}; throw error;
}
operatorLib.callOperator=async (target,options={})=>{upstreamAuth(options);return {target,bridgeSession:options.bridgeSession};};
operatorLib.execOperator=async (payload,options={})=>{upstreamAuth(options);return {payload,bridgeSession:options.bridgeSession};};
mcpLib.callMcpTool=async (name,args,options={})=>{upstreamAuth(options);return {name,args,bridgeSession:options.bridgeSession};};
const {runReadTool}=require('../../lib/http');
const operatorHandler=require('../../api/operator');
function resMock(){return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
let res=resMock();
await runReadTool({method:'GET',query:{},headers:{}},res,'ping');
if(res.statusCode!==401||res.body?.upstream?.error!=='bridge_session_required') throw new Error('anonymous_read_not_rejected_upstream');
res=resMock();
await operatorHandler({method:'GET',query:{action:'capabilities'},headers:{}},res);
if(res.statusCode!==401||res.body?.upstream?.error!=='bridge_session_required') throw new Error('anonymous_operator_not_rejected_upstream');
res=resMock();
await runReadTool({method:'GET',query:{},headers:{'x-bridge-session':'session-test'}},res,'ping');
if(res.statusCode!==200||res.body?.upstream?.bridgeSession!=='session-test') throw new Error('bridge_session_read_not_forwarded');
res=resMock();
await operatorHandler({method:'GET',query:{action:'capabilities'},headers:{'x-bridge-session':'session-test'}},res);
if(res.statusCode!==200||res.body?.upstream?.bridgeSession!=='session-test') throw new Error('bridge_session_operator_not_forwarded');
console.log('no-static-shared-bearer=PASS');
console.log('anonymous-read-upstream-reject=PASS');
console.log('anonymous-operator-upstream-reject=PASS');
console.log('bridge-session-forwarding=PASS');
