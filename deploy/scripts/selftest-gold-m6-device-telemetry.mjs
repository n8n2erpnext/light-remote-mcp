import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {DeviceResourceSampler,DeviceResourceSampleCache,sanitizeDeviceResourceSample} from '../../lib/device-resource-telemetry.mjs';
import {fleetJobPage} from '../../device-agent/fleet-job-page.mjs';

let time=1792660000000,step=0;
const cpuSamples=[
 [{times:{user:1000,sys:200,idle:2800}}],
 [{times:{user:1200,sys:250,idle:3150}}]
];
const sampler=new DeviceResourceSampler({
 clock:()=>time,
 cpus:()=>cpuSamples[Math.min(step,1)],
 totalmem:()=>8000000000,freemem:()=>2000000000,
 cpuUsage:()=>step?{user:400000,system:120000}:{user:200000,system:20000},
 memoryUsage:()=>({rss:140000000}),
 resourceUsage:()=>step?{fsRead:22,fsWrite:19}:{fsRead:10,fsWrite:5},
 diskIo:()=>step?{readBytes:32000,writeBytes:11000}:{readBytes:8000,writeBytes:1000}
});
const first=sampler.sample();
assert.equal(first.hostCpuPercent,null);
assert.equal(first.agentFsReadOps,null);
step=1;time+=5000;
const second=sampler.sample();
assert.equal(second.version,1);
assert.equal(second.windowMs,5000);
assert.equal(second.hostCpuPercent,41.7);
assert.equal(second.hostMemoryUsedBytes,6000000000);
assert.equal(second.agentCpuPercent,6);
assert.equal(second.agentFsReadOps,12);
assert.equal(second.agentFsWriteOps,14);
assert.equal(second.agentDiskReadBytes,24000);
assert.equal(second.agentDiskWriteBytes,10000);
assert.equal(second.ioScope,'agent_process');
assert.equal(second.hostScope,'host');
console.log('M6_SIGNED_METRIC_HOST_AGENT_SEMANTICS=PASS');

const cache=new DeviceResourceSampleCache({now:()=>time,ttlMs:90000,maxDevices:2});
assert.equal(cache.record({accountId:'a1',deviceId:'d1',value:second}),true);
assert.equal(cache.get('a1','d1').state,'fresh');
assert.equal(cache.get('a2','d1').state,'unknown');
assert.equal(cache.get('a1','d2').state,'unknown');
const invalid={...second,hostMemoryUsedBytes:999999999999};
assert.equal(cache.record({accountId:'a1',deviceId:'d2',value:invalid}),false);
assert.equal(cache.record({accountId:'a1',deviceId:'d2',value:{...second,sampledAt:time+50000}}),false);
time+=90001;
assert.equal(cache.get('a1','d1').state,'stale');
assert.equal(cache.get('a1','d1').sample.sampledAt,second.sampledAt);
assert.equal(sanitizeDeviceResourceSample(second,{now:time,maxAgeMs:120000})?.version,1);
time+=30001;
assert.equal(sanitizeDeviceResourceSample(second,{now:time,maxAgeMs:120000}),null);
console.log('M6_METRIC_ACCOUNT_ISOLATION_AND_STALE_FAIL_CLOSED=PASS');

const source=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
const routes=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
assert.equal((source.match(/resourceSample:DEVICE_RESOURCE_SAMPLER.sample\(\)/g)||[]).length,3);
assert.equal((routes.match(/deviceResourceSampleCache.record\(/g)||[]).length,3);
assert.match(routes,/deviceResourceSampleCache.get\(ctx.account.accountId,resource.deviceId\)/);
const manifest=JSON.parse(fs.readFileSync(new URL('../../client/core-files.json',import.meta.url)));
assert.ok(manifest.files.some(x=>x.source==='lib/device-resource-telemetry.mjs'));
console.log('M6_SIGNED_POLL_PULSE_DUPLEX_AND_PACKAGE=PASS');

const html=fleetJobPage();
assert.match(html,/Agent-process-only/);
assert.match(html,/STALE/);
assert.match(html,/No automatic unlock/);
const inline=html.split('<script>')[1]?.split('</script>')[0];
assert.ok(inline);
new vm.Script(inline,{filename:'fleet-job-page.inline.js'});
console.log('M6_HOST_METRICS_DEVICE_FLEET_WALL_UI=PASS');
