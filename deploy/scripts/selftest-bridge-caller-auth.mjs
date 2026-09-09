import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { isBridgeCallerAuthorized } = require('../../lib/caller-auth');
const { runReadTool } = require('../../lib/http');
const operatorHandler = require('../../api/operator');

function resMock() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k,v){ this.headers[String(k).toLowerCase()] = v; },
    status(n){ this.statusCode=n; return this; },
    json(v){ this.body=v; return this; }
  };
}

const prior = process.env.VPS_BRIDGE_CALLER_SECRET;
delete process.env.VPS_BRIDGE_CALLER_SECRET;
let req={method:'GET',query:{action:'capabilities'},headers:{}};
let res=resMock();
await operatorHandler(req,res);
if(res.statusCode!==401||res.body?.error!=='bridge_caller_auth_required') throw new Error('operator_default_deny_failed');
res=resMock();
await runReadTool({method:'GET',query:{},headers:{}},res,'ping');
if(res.statusCode!==401||res.body?.error!=='bridge_caller_auth_required') throw new Error('read_default_deny_failed');
process.env.VPS_BRIDGE_CALLER_SECRET='0123456789abcdef0123456789abcdef';
if(isBridgeCallerAuthorized({headers:{authorization:'Bearer wrong'}})) throw new Error('wrong_secret_accepted');
if(!isBridgeCallerAuthorized({headers:{authorization:'Bearer 0123456789abcdef0123456789abcdef'}})) throw new Error('valid_secret_rejected');
if(prior===undefined) delete process.env.VPS_BRIDGE_CALLER_SECRET; else process.env.VPS_BRIDGE_CALLER_SECRET=prior;
console.log('bridge-caller-auth-default-deny=PASS');
console.log('bridge-caller-auth-bearer-guard=PASS');
