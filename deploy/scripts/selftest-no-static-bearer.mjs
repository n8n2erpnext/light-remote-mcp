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
if(!guide.includes('no static shared Bearer secret')) throw new Error('guide_missing_no_static_bearer_contract');

const operatorLib=require('../../lib/operator');
const mcpLib=require('../../lib/mcp');
operatorLib.callOperator=async target=>({target,anonymousReach:true});
operatorLib.execOperator=async payload=>({payload,anonymousReach:true});
mcpLib.callMcpTool=async (name,args)=>({name,args,anonymousReach:true});
const {runReadTool}=require('../../lib/http');
const operatorHandler=require('../../api/operator');
function resMock(){return {statusCode:200,headers:{},body:null,setHeader(k,v){this.headers[String(k).toLowerCase()]=v;},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};}
let res=resMock();
await runReadTool({method:'GET',query:{},headers:{}},res,'ping');
if(res.statusCode!==200||res.body?.upstream?.anonymousReach!==true) throw new Error('anonymous_read_did_not_reach_upstream');
res=resMock();
await operatorHandler({method:'GET',query:{action:'capabilities'},headers:{}},res);
if(res.statusCode!==200||res.body?.upstream?.anonymousReach!==true) throw new Error('anonymous_operator_did_not_reach_upstream');
console.log('no-static-bridge-bearer=PASS');
console.log('anonymous-read-bridge=PASS');
console.log('anonymous-operator-bridge=PASS');
