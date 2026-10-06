import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SupportOutbox } from '../../plugin-server/support-backoffice.mjs';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const source=fs.readFileSync(path.join(root,'plugin-server/support-backoffice.mjs'),'utf8');
const page=fs.readFileSync(path.join(root,'plugin-server/support-page.mjs'),'utf8');
const server=fs.readFileSync(path.join(root,'plugin-server/server.mjs'),'utf8');
function need(ok,name){if(!ok)throw new Error('support_backoffice_contract_failed:'+name);console.log(name+'=PASS');}

need(source.includes("ELIGIBLE_PLANS=new Set(['pro','vip'])")&&source.includes("support_plan_required"),'paid-case-gate');
need(source.includes('redactRestrictedText')&&source.includes('support_contains_sensitive_material'),'secret-redaction-gate');
need(source.includes('x-light-account-session')&&source.includes("'/v1/accounts/me'"),'server-side-account-plan');
need(source.includes('SupportOutbox')&&source.includes('nextAttemptAt')&&source.includes('backoffMs'),'durable-retry-outbox');
need(page.includes('Open a private support case')&&page.includes('/support/api?action=eligibility')&&page.includes('Private case submission is available on PRO/VIP'),'support-form-ui');
need(server.includes("registerSupportBackoffice(app)"),'support-route-registration');

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-support-outbox-'));
const stateFile=path.join(dir,'outbox.json');
const configFile=path.join(dir,'backoffice.json');
fs.writeFileSync(configFile,JSON.stringify({schemaVersion:1,endpoint:'https://erp.example.test/api/method/light_backoffice.api.create_support_case',apiKey:'key',apiSecret:'secret'}),{mode:0o600});
let now=1_000_000,calls=0,lastRequest=null;
const fetchImpl=async(url,options)=>{
  calls++;lastRequest={url,options};
  return new Response(JSON.stringify({message:{accepted:true,status:'Received'}}),{status:200,headers:{'content-type':'application/json'}});
};
const outbox=new SupportOutbox({stateFile,configFile,fetchImpl,now:()=>now});
const account={accountId:'acct-test',email:'pro@example.test',plan:'pro'};
const payload={source_product:'Light Remote',account_email:account.email,account_plan:'PRO',account_id:account.accountId,source_reference:'web-support',subject:'Test case',description:'Test body',diagnostics:{problem_area:'remote'}};
const queued=outbox.enqueue({account,payload,eventId:'lr.support.test-1'});
assert.equal(queued.status,'queued');
assert.equal(fs.statSync(stateFile).mode&0o777,0o600);
const reloaded=new SupportOutbox({stateFile,configFile,fetchImpl,now:()=>now});
assert.equal(reloaded.get('lr.support.test-1','acct-test')?.status,'queued');
await reloaded.pump();
assert.equal(calls,1);
assert.equal(reloaded.get('lr.support.test-1','acct-test')?.status,'sent');
assert.equal(lastRequest.options.headers.authorization,'token key:secret');
assert.equal(JSON.parse(lastRequest.options.body).event_id,'lr.support.test-1');
console.log('durable-delivery=PASS');

let retryCalls=0;
const retryFetch=async()=>{
  retryCalls++;
  if(retryCalls===1)return new Response(JSON.stringify({error:'down'}),{status:503});
  return new Response(JSON.stringify({message:{accepted:true,status:'Received'}}),{status:200});
};
const retryState=path.join(dir,'retry.json');
const retryBox=new SupportOutbox({stateFile:retryState,configFile,fetchImpl:retryFetch,now:()=>now});
retryBox.enqueue({account,payload,eventId:'lr.support.test-2'});
await retryBox.pump();
const failed=retryBox.get('lr.support.test-2','acct-test');
assert.equal(failed.status,'queued');
assert.equal(failed.attempts,1);
assert.ok(failed.nextAttemptAt>now);
now=failed.nextAttemptAt;
await retryBox.pump();
assert.equal(retryBox.get('lr.support.test-2','acct-test')?.status,'sent');
assert.equal(retryCalls,2);
console.log('retry-backoff=PASS');

const internalConfig=path.join(dir,'backoffice-internal.json');
fs.writeFileSync(internalConfig,JSON.stringify({schemaVersion:1,endpoint:'http://10.192.135.70/api/method/light_backoffice.api.create_support_case_internal',siteHost:'erpnext.thaiduy.digital',authMode:'internal-network'}),{mode:0o600});
let internalHeaders=null;
const internalFetch=async(_url,options)=>{internalHeaders=options.headers;return new Response(JSON.stringify({message:{accepted:true,status:'Received'}}),{status:200});};
const internalState=path.join(dir,'internal.json');
const internalBox=new SupportOutbox({stateFile:internalState,configFile:internalConfig,fetchImpl:internalFetch,now:()=>now});
internalBox.enqueue({account,payload,eventId:'lr.support.test-internal'});
await internalBox.pump();
assert.equal(internalBox.get('lr.support.test-internal','acct-test')?.status,'sent');
assert.equal(Object.hasOwn(internalHeaders,'authorization'),false);
assert.equal(internalHeaders.host,'erpnext.thaiduy.digital');
console.log('internal-network-delivery=PASS');

fs.rmSync(dir,{recursive:true,force:true});
console.log('SUPPORT_BACKOFFICE_GATE=PASS');
