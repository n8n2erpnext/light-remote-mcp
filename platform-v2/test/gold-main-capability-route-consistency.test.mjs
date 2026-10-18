import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isOutboundTarget} from '../../lib/operator-target-route.mjs';

const source=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
const decision=(integratedHostEnabled,localNodeId,targetNodeId)=>
 isOutboundTarget({integratedHostEnabled,localNodeId,targetNodeId});

test('Main local policy is authoritative ONLY if integrated host is enabled and node matches',()=>{
 assert.equal(decision(true,'arm','arm'),false);
 assert.equal(decision(true,'arm','leaf-1'),true);
 assert.equal(decision(false,'arm','arm'),true,
  'A separated Operator must route the same nodeId via enrollment/Fleet');
 assert.equal(decision(false,'arm','leaf-1'),true);
});
test('Runtime route classification and device inspection derive from one security decision',()=>{
 const routes=source.slice(source.indexOf('function routingViewForDevice('),
  source.indexOf('function connectionViewForDevice('));
 for(const functionName of ['routingViewForDevice','policyViewForDevice']){
  assert.match(routes,new RegExp('function '+functionName+'\\(device\\)'));
 }
 assert.equal((routes.match(/!isOutboundTarget\(\{integratedHostEnabled:INTEGRATED_HOST_ENABLED,localNodeId:NODE_ID,targetNodeId:device.nodeId\}\)/g)||[]).length,2,
  'Both effective routing and policy UI must use job execution route classification');
 const target=source.slice(source.indexOf('function targetRoute('),
  source.indexOf('class DeviceChannelRateLimitError'));
 assert.match(target,/!isOutboundTarget\(\{integratedHostEnabled:INTEGRATED_HOST_ENABLED,localNodeId:NODE_ID,targetNodeId:nodeId\}\)/);
 assert.match(target,/const binding=enrollments\.binding\(device\.deviceId\), allowed=new Set\(binding\.approvedCapabilities\|\|\[\]\)/);
 assert.match(target,/capabilities:\(route\.capabilities\|\|\[\]\)\.filter\(cap=>allowed\.has\(cap\)\)/);
 assert.doesNotMatch(target,/if \(nodeId===NODE_ID\)/,
  'An unintegrated local-ID match must not borrow the host Docker grant');
});
test('Actual job routing retains fail-closed, independently approved capability admission',()=>{
 const start=source.slice(source.indexOf('function startJob('),
  source.indexOf('function startNativeFileJob('));
 assert.match(start,/remote=isOutboundTarget\(/);
 assert.match(start,/route=targetRoute\(session\.nodeId/);
 assert.match(start,/const missing=requiredCapabilities\.filter\(cap=>!route\.capabilities\.includes\(cap\)\)/);
 assert.match(start,/if\(missing\.length\)throw new FleetError\('target_node_capability_missing',409\)/);
 assert.match(start,/if\(missing\.length\)throw new DeviceError\('local_host_capability_missing',409\)/);
});
