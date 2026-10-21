/**
 * Bounded Gold G3 local TCP/Executor soak. Does not enroll a device or mutate
 * any persistent service. Each fixture binds only 127.0.0.1 on an ephemeral port.
 *
 * Usage: node deploy/scripts/soak-g3-duplex-readiness.mjs --cycles 4
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2);
const cycleIndex=args.indexOf('--cycles');
const cycles=cycleIndex>=0?Number(args[cycleIndex+1]):4;
assert.ok(Number.isInteger(cycles)&&cycles>=1&&cycles<=24,'g3_soak_cycles_out_of_bounds');
const caseTimeoutMs=30000;
// Gold G6 source-soak budgets; not a substitute for physical Agent UAT.
const maxRssKiB=Math.max(32*1024,Math.min(Number(process.env.G6_MAX_CHILD_RSS_KIB)||192*1024,1024*1024));
const maxCaseDurationMs=Math.max(10000,Math.min(Number(process.env.G6_MAX_CASE_MS)||27000,caseTimeoutMs));
const scenarios=[
  {file:'selftest-g3-duplex-reconnect-inflight.mjs',markers:[
    'G3_TRANSPORT_DROP_RECONNECT_WITH_HELD_EXECUTOR=PASS',
    'G3_NO_REPLAY_OR_FALSE_FINISH_WHEN_RECONNECT=PASS',
    'G3_LATE_RESULT_RESUMES_DISPATCH_AFTER_RECONNECT=PASS'
  ]},
  {file:'selftest-g3-executor-hang-readiness.mjs',markers:[
    'G3_HUNG_EXECUTOR_FRESH_CHANNEL_ADMISSION_DENIED=PASS',
    'G3_UNCERTAIN_EFFECT_NOT_REPLAYED_OR_FAKE_COMPLETED=PASS',
    'G3_LATE_EXECUTOR_COMPLETION_RECOVERS_WITHOUT_DUPLICATE=PASS'
  ]},
  {file:'selftest-g3-duplex-halfopen-watchdog.mjs',markers:[
    'G3_HALF_OPEN_STREAM_WATCHDOG_RECONNECT=PASS',
    'G3_HEALTHY_SERVER_FRAMES_PREVENT_FALSE_RECONNECT=PASS',
    'G3_HALF_OPEN_DIAGNOSTICS=PASS'
  ]}
];
const percentile=(numbers,p)=>{
  const sorted=numbers.toSorted((a,b)=>a-b);
  if(!sorted.length)return null;
  return Math.round(sorted[Math.max(0,Math.min(sorted.length-1,Math.ceil(p*sorted.length)-1))]);
};
function procRssKiB(pid){
  if(process.platform!=='linux')return null;
  try{
    const m=/^VmRSS:\s*(\d+)\s*kB/m.exec(fs.readFileSync('/proc/'+pid+'/status','utf8'));
    return m?Number(m[1]):null;
  }catch{return null;}
}
async function runCase(scenario,cycle){
  const filename=path.join(root,'deploy/scripts',scenario.file);
  assert.ok(fs.existsSync(filename),'g3_soak_fixture_missing:'+scenario.file);
  const begin=performance.now();
  let child;
  const result=await new Promise(resolve=>{
    child=spawn(process.execPath,[filename],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',peakRssKiB=0,samples=0,timedOut=false,overflow=false,closed=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},caseTimeoutMs);
    const meter=setInterval(()=>{
      const n=procRssKiB(child.pid);
      if(n!=null){samples++;peakRssKiB=Math.max(peakRssKiB,n);}
    },80);
    child.stdout.on('data',buf=>{stdout+=buf.toString();if(stdout.length>32768){overflow=true;child.kill('SIGKILL');}});
    child.stderr.on('data',buf=>{stderr+=buf.toString();if(stderr.length>8192){overflow=true;child.kill('SIGKILL');}});
    child.once('error',error=>{stderr+='\nspawn_error:'+String(error.message);});
    child.once('close',(exitCode,signal)=>{
      if(closed)return;closed=true;clearTimeout(timer);clearInterval(meter);
      resolve({scenario:scenario.file,cycle,exitCode,signal,timedOut,overflow,ms:Math.round(performance.now()-begin),peakRssKiB,samples,stdout,stderr});
    });
  });
  for(const marker of scenario.markers){
    if(result.exitCode!==0||result.timedOut||result.overflow||!result.stdout.split(/\r?\n/).includes(marker)){
      const summary={...result,stdout:result.stdout.slice(-1500),stderr:result.stderr.slice(-800)};
      throw Error('G3_SOAK_CASE_FAILED '+JSON.stringify({expectedMarker:marker,...summary}));
    }
  }
  if(result.ms>maxCaseDurationMs)throw Error('G6_CHILD_CASE_LATENCY_BUDGET_EXCEEDED:'+result.scenario);
  if(process.platform==='linux'&&(!result.samples||result.peakRssKiB>maxRssKiB))throw Error('G6_CHILD_CASE_RSS_BUDGET_EXCEEDED:'+result.scenario);
  return {scenario:result.scenario,cycle,ms:result.ms,peakRssKiB:result.peakRssKiB,rssSamples:result.samples,exitCode:result.exitCode};
}
const started=performance.now(),rows=[];
for(let cycle=1;cycle<=cycles;cycle++){
  for(const scenario of scenarios){
    const row=await runCase(scenario,cycle);
    rows.push(row);
    console.log('G3_SOAK_CASE=PASS scenario='+row.scenario+' cycle='+cycle+' durationMs='+row.ms+' sampledPeakRssKiB='+row.peakRssKiB);
  }
}
const summary={
  status:'PASS',
  environment:{platform:process.platform,arch:process.arch,node:process.version,hostname:os.hostname()},
  cycles,
  successfulProcesses:rows.length,
  resourceBudget:{maxRssKiB,maxCaseDurationMs},
  totalDurationMs:Math.round(performance.now()-started),
  source:'localhost TCP / real FleetRouter and duplex client fixtures; independent ephemeral child processes',
  limitations:'not an enrolled Agent, no production, no cross-process resource leak proof; RSS is sampled Linux VmRSS',
  cases:scenarios.map(s=>{
    const values=rows.filter(x=>x.scenario===s.file);
    return {scenario:s.file,count:values.length,durationP50Ms:percentile(values.map(x=>x.ms),.5),
      durationP95Ms:percentile(values.map(x=>x.ms),.95),
      sampledPeakRssKiB:Math.max(...values.map(x=>x.peakRssKiB)),
      rssSampleCount:values.reduce((a,x)=>a+x.rssSamples,0)};
  })
};
console.log('G3_SOAK_SUMMARY='+JSON.stringify(summary));
console.log('G3_BOUNDED_REAL_TCP_PROCESS_SOAK=PASS');
