import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fleetJobPage} from '../../device-agent/fleet-job-page.mjs';
import {DeviceResourceSampleCache} from '../../lib/device-resource-telemetry.mjs';
const src=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const a=src.indexOf('const fleetStopDispatching=new Set();');
const b=src.indexOf('const routeDeps=()=>({',a);
assert.ok(a>0&&b>a,'fleet_stop_helper_not_found');
const processId='lp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';
const launch={id:'11111111-1111-4111-8111-111111111111',accountId:'owner',deviceId:'dev-A',
 sessionId:'session-original',agentId:'plugin-signed-agent-original',nodeId:'leaf-A',
 finishedAt:1000,exitCode:0,managedExec:true,note:'native-process:start'};
let pgClaim=true,invocations=[],events=[],identityMismatch=false;
const jobs=new Map([[launch.id,launch]]);
class FleetAuthorityError extends Error{constructor(message,status){super(message);this.status=status;}}
const context={
 Set,jobs,crypto,FleetAuthorityError,DeviceResourceSampleCache,deviceResourceLocks:{},
 goldStorage:{pool:{async query(sql,args){assert.match(sql,/account_id=\$2/);assert.match(sql,/device_id=\$3/);
  assert.deepEqual([...args],[launch.id,'owner','dev-A']);
  assert.ok(!/DELETE|UPDATE/i.test(sql),'stop_api_must_not_release_claim');
  return {rows:pgClaim?[{process_id:processId}]:[]};}}},
 sessions:{ensure(sessionId,{agentId}){assert.equal(sessionId,launch.sessionId);assert.equal(agentId,launch.agentId);
  return {accountId:identityMismatch?'other':'owner',deviceId:'dev-A',nodeId:'leaf-A'};}},
 async startProcessOperation(payload,requestId){invocations.push({payload,requestId});return {id:'22222222-2222-4222-8222-222222222222'};},
 pushEvent:e=>events.push(e)
};
vm.createContext(context);
vm.runInContext(src.slice(a,b)+'\nthis.testStop=requestFleetProcessStop;',context);
const scope={jobId:launch.id,accountId:'owner',deviceIds:new Set(['dev-A'])};
const reject=async(args,status)=>{await assert.rejects(context.testStop(args),e=>e.status===status);};
await reject({...scope,accountId:'other'},404);
await reject({...scope,deviceIds:new Set(['dev-B'])},404);
pgClaim=false;await reject(scope,409);assert.equal(invocations.length,0);
pgClaim=true;identityMismatch=true;await reject(scope,403);identityMismatch=false;
const accepted=await context.testStop(scope);
assert.equal(accepted.state,'stop_requested');
assert.equal(accepted.terminalVerified,false);
assert.equal(invocations.length,1);
assert.equal(invocations[0].payload.process.force,false);
assert.equal(invocations[0].payload.process.processId,processId);
assert.equal(invocations[0].payload.agentId,launch.agentId);
assert.equal(invocations[0].payload.sessionId,launch.sessionId);
await reject(scope,409);
assert.equal(events[0].type,'fleet_owner_process_stop_requested');
const page=fleetJobPage({csrfToken:'dummy_csrf'});
assert.match(page,/Request Stop/);
assert.match(page,/api\/jobs\/stop/);
assert.match(page,/x-light-remote-csrf/);
assert.match(page,/awaiting terminal receipt|terminal receipt/);
const browserJs=page.split('<script>')[1]?.split('</script>')[0];
assert.ok(browserJs);
new vm.Script(browserJs,{filename:'fleet-job-page.inline.js'});
console.log('M6_STOP_ORIGINAL_SIGNED_AGENT_BOUND=PASS');
console.log('M6_STOP_PG_LEASE_AND_OWNER_SCOPED=PASS');
console.log('M6_STOP_REQUEST_ONLY_NO_RELEASE=PASS');
console.log('M6_STOP_REPEAT_REJECTED=PASS');
console.log('M6_STOP_BROWSER_CSRF_JS=PASS');
