import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8');
const start=src.indexOf('function renderJob(j){'),end=src.indexOf('async function stopWallJob(j,button){',start);
assert.ok(start>0&&end>start,'Wall rendering function boundaries must be found');
// Server-side Material Icon template expressions resolve before browser JS runs.
const snippet=src.slice(start,end).replace(/\$\{materialIcon\('[^']+'\)\}/g,'');
const dom=new Map(),buttons={};
const make=()=>({innerHTML:'',querySelector(selector){const b={onclick:null};buttons[selector]=b;return b;}});
const box={children:[],prepend(el){this.children.unshift(el);dom.set(el.id,el);},get lastChild(){return this.children.at(-1);}};
const context={
 document:{getElementById:id=>dom.get(id),createElement:()=>make()},
 box,jobs:new Map(),
 toolLabel:()=>'',fallbackCommandBadge:()=>'',terminalHandle:()=>'',scpInlineProgress:()=>'',
 riskBadge:()=>null,groupBadgeClass:()=>'',shellSyntaxHtml:value=>String(value),
 commandText:j=>j.script||'',materialIcon:()=>'',short:value=>String(value||''),
 esc:value=>String(value??''),copyText:()=>{},jobText:()=>'',stopWallJob:()=>{},
};
vm.createContext(context);vm.runInContext(snippet+';globalThis.testRender=renderJob;',context,{timeout:1000});
const j={jobId:'11111111-1111-4111-8111-111111111111',status:'running',stopRequested:false,
 script:'fixture harmless',sessionId:'fixture-session',agentId:'fixture-agent',at:new Date().toISOString()};
const html=()=>dom.get('j-'+j.jobId)?.innerHTML||'';
context.testRender(j);
assert.match(html(),/<span class="running">running<\/span>/);
assert.match(html(),/data-stop="job"/);assert.match(html(),/<span>Kill<\/span>/);
j.stopRequested=true;context.testRender(j);
assert.match(html(),/<span class="stopping">stopping<\/span>/);
assert.match(html(),/data-stop="job" disabled aria-disabled="true"/);
assert.match(html(),/<span>Stopping…<\/span>/);
assert.doesNotMatch(html(),/<span class="cancelled">cancelled<\/span>/);
assert.equal(j.status,'running','presentation must not alter authoritative job state');
j.status='cancelled';j.stopRequested=false;context.testRender(j);
assert.match(html(),/<span class="cancelled">cancelled<\/span>/);
assert.doesNotMatch(html(),/aria-disabled="true"/);
console.log('P0_WALL_ACTUAL_RENDER_RUNNING_STOPPING_TERMINAL_NO_FALSE_ACK_PASS');
