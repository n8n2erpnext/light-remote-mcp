import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
function section(start,end){
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing actual Wall source block '+start);
 return src.slice(a,b);
}
const snippets=[
 section('let goldReaderGeneration=0','async function goldReaderRefresh('),
 section('async function goldReaderRequest(','async function goldReaderExport('),
 section('async function goldReaderExport(','let goldMemoryUsageCache='),
 section('async function goldReaderPreferenceRefresh(','document.getElementById(\'goldReaderScope\').addEventListener(')
];
const selected={value:'scope-A'};
const preview={hidden:true,textContent:''};
const status={textContent:''};
const option={checked:false,disabled:true};
const area={hidden:false};
const elements={goldReaderScope:selected,goldReaderPreview:preview,
 goldReaderStatus:status,goldContextOptIn:option,goldMemoryArea:area};
const document={getElementById:id=>elements[id],body:{appendChild:()=>{}},
 createElement:()=>({click(){throw Error('stale export must not download')},remove(){}})};
const requests=[];
const fetch=(url,opts)=>new Promise(resolve=>requests.push({url,opts,resolve}));
const context=vm.createContext({document,fetch,AbortController,Promise,Error,URL:{
 createObjectURL:()=>{throw Error('must not export stale work')},
 revokeObjectURL:()=>{},},Blob,JSON,String,Date,setTimeout:()=>0});
vm.runInContext(snippets.join('\n'),context);
const readA=vm.runInContext('goldReaderRead()',context);
assert.match(requests.at(-1).url,/scopeId=scope-A/);
selected.value='scope-B';
vm.runInContext('goldReaderInvalidate()',context);
const readB=vm.runInContext('goldReaderRead()',context);
requests[1].resolve({ok:true,json:async()=>({ok:true,handoff:{
 scopeId:'scope-B',displayName:'Work B',checkpoints:[{title:'B',body:'B_SECRET'}]}})});
assert.equal(await readB,true);
requests[0].resolve({ok:true,json:async()=>({ok:true,handoff:{
 scopeId:'scope-A',displayName:'Work A',checkpoints:[{title:'A',body:'A_SECRET'}]}})});
assert.equal(await readA,false);
assert.match(preview.textContent,/B_SECRET/);
assert.doesNotMatch(preview.textContent,/A_SECRET/);
assert.equal(selected.value,'scope-B');
// No accidental export/download if the selected scope changes before response.
const exportB=vm.runInContext("goldReaderExport('json')",context);
assert.match(requests[2].url,/scopeId=scope-B/);
selected.value='scope-A';vm.runInContext('goldReaderInvalidate()',context);
requests[2].resolve({ok:true,json:async()=>({ok:true,export:{
 scopeId:'scope-B',displayName:'Work B',integrity:'all_current_epoch_revisions_verified',
 checkpointCount:0,checkpoints:[]}})});
assert.equal(await exportB,false);
// Stale context preference GET must not overwrite another selected scope.
const prefA=vm.runInContext('goldReaderPreferenceRefresh()',context);
assert.match(requests[3].url,/scopeId=scope-A/);
selected.value='scope-B';vm.runInContext('goldReaderInvalidate()',context);
requests[3].resolve({ok:true,json:async()=>({ok:true,preference:{fullContextOptIn:true}})});
await prefA;
assert.equal(option.checked,false);
assert.equal(option.disabled,true);
// Disable Memory invalidates current reading and clears the visible content.
assert.equal(preview.hidden,true);
assert.equal(preview.textContent,'');
console.log('T11_LONG_MEMORY_SCOPE_A_B_REVERSED_PREF_EXPORT_ABORT_PASS');
// Re-run actual Wall reducer functions with out-of-order event records.
const reducer=section('const GOLD_TERMINAL_JOB_STATES=','let statusEpoch=0;');
const jobs=new Map();let rendered=0;
const runner=vm.createContext({jobs,paused:false,eventSeen:()=>false,
 pending:[],pendingKeys:new Set(),eventKey:e=>e.type+e.jobId,
 rememberEvent:()=>{},safeOutputChunk:x=>String(x),LEGACY_BINARY_MARKER:'[BINARY]',
 scheduleRender:()=>rendered++,refreshStatus:()=>{},document:{getElementById:()=>null},
 Date,Set,Map,JSON,String,Number});
vm.runInContext(reducer,runner);
const ingest=e=>vm.runInContext('ingest(input,false)',vm.createContext({...runner,input:e}));
const call=e=>{runner.input=e;vm.runInContext('ingest(input,false)',runner);};
call({type:'job_finished',jobId:'job-1',status:'ok',at:'2026-11-07T01:00:02Z',
 script:'echo test',resultSummary:'finished'});
const terminal=jobs.get('job-1');
assert.equal(terminal.status,'ok');
assert.equal(terminal.finishedAt,'2026-11-07T01:00:02Z');
call({type:'node_command_queued',jobId:'job-1',at:'2026-11-07T01:00:00Z'});
call({type:'node_command_dispatched',jobId:'job-1',at:'2026-11-07T01:00:01Z'});
call({type:'job_started',jobId:'job-1',status:'running',at:'2026-11-07T01:00:00Z'});
call({type:'job_stop_requested',jobId:'job-1'});
assert.equal(terminal.status,'ok','no stale history downgrade');
assert.equal(terminal.stopRequested,false);
call({type:'stdout',jobId:'job-1',chunk:'late output'});
assert.match(terminal.stdout,/late output/,'post-finish chunks are merged');
call({type:'job_finished',jobId:'job-1',status:'error',at:'2026-11-07T01:00:01Z'});
assert.equal(terminal.status,'ok','older duplicate finish cannot overwrite terminal');
assert.equal(terminal.finishedAt,'2026-11-07T01:00:02Z');
console.log('T11_WALL_SSE_TERMINAL_MONOTONIC_LATE_OUTPUT_PASS');
