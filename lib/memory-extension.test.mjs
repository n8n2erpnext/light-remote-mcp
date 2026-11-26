import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const dir=new URL('../extensions/light-remote-lm-abv2/',import.meta.url),read=name=>fs.readFileSync(new URL(name,dir),'utf8');
const env={URL,Date,TextEncoder,TextDecoder,crypto:webcrypto,Event,AbortSignal,console};
function load(name,values={}){const c=vm.createContext({...env,...values});vm.runInContext(read(name),c);return c;}
test('extension core allows explicit approved Walls and hashes the reviewed content',async()=>{
 const c=load('shared.js'),m=c.LightRemoteMemory;
 assert.equal(m.wall('http://127.0.0.1:5491/').url,'http://127.0.0.1:5491/long-memory');
 assert.equal(m.wall('http://100.94.184.141:15591/long-memory').url,'http://100.94.184.141:15591/long-memory');
 for(const u of ['https://evil.test/long-memory','http://127.0.0.1:5491/approve','http://u:p@localhost:5491/','http://localhost:5491/?token=x','http://127.0.0.2:5491/','http://100.94.184.142:15591/'])assert.throws(()=>m.wall(u));
 const x={ok:true,provider:'claude',url:'https://claude.ai/chat/id',coverage:'loaded_dom_only',turns:2,text:'explicitly reviewed'};
 x.contentSha256=await m.hash(x.text);assert.equal(await m.validCapture(x),true);
 assert.equal(await m.validCapture({...x,text:'changed'}),false);assert.equal(await m.validCapture({...x,provider:'chatgpt'}),false);
});
function message(role,text,{provider='chatgpt',blocks=[],hidden=false}={}){
 const parent={parentElement:null,hidden,closest:()=>null,getAttribute:()=>null};
 return {parentElement:parent,hidden:false,getAttribute:key=>key==='data-message-author-role'?role:key==='data-testid'?(role==='user'?'user-message':'assistant-message'):null,
  closest:s=>s==='main'?{}:null,querySelectorAll:()=>blocks,innerText:text};
}
for(const provider of ['chatgpt','claude'])test(provider+' capture excludes hidden ancestors, preserves multiple code blocks and detects changing text',async()=>{
 const a={innerText:'First paragraph\n    indented code',parentElement:null,contains:()=>false,getAttribute:()=>null};
 const b={innerText:'Second paragraph\n\tcode 😀 Việt',parentElement:null,contains:()=>false,getAttribute:()=>null};
 const assistant=message('assistant','fallback must not replace blocks',{blocks:[a,b]});
 const nodes=[message('user','Question'),message('assistant','HIDDEN_SECRET',{hidden:true}),assistant];
 const c=load('capture.js',{location:{href:provider==='chatgpt'?'https://chatgpt.com/c/test-id-123?secret=x':'https://claude.ai/chat/test-id-123'},document:{querySelectorAll:()=>nodes},getComputedStyle:()=>({display:'block',visibility:'visible'})});
 const first=await c.lightRemoteLmCaptureSegment({maxBytes:4096});
 assert.equal(first.ok,true);assert.equal(first.provider,provider);assert.equal(first.turns,2);assert.doesNotMatch(first.chunk,/HIDDEN_SECRET|fallback/);
 assert.match(first.chunk,/    indented code/);assert.match(first.chunk,/Second paragraph\n\tcode 😀 Việt/);assert.ok(!first.sourceUrl.includes('?'));
 b.innerText+='changed';const stale=await c.lightRemoteLmCaptureSegment({maxBytes:4096,expectedSha256:first.sha256});assert.equal(stale.stale,true);assert.equal(stale.chunk,undefined);
});
test('large Unicode capture segments reconstruct exact UTF8/hash, no partial changed snapshot',async()=>{
 const text='ạ😀中文\n'.repeat(3000),node=message('assistant',text);
 const c=load('capture.js',{location:{href:'https://claude.ai/chat/unicode-id'},document:{querySelectorAll:()=>[node]},getComputedStyle:()=>({})});
 let offset=0,sha=null,total=0;const pieces=[];
 do{const p=await c.lightRemoteLmCaptureSegment({offset,expectedSha256:sha,maxBytes:4096});assert.equal(p.ok,true);sha??=p.sha256;total=p.totalBytes;pieces.push(Buffer.from(p.chunk));offset=p.nextOffset;}while(offset!==null);
 const bytes=Buffer.concat(pieces);assert.equal(bytes.length,total);assert.equal(createHash('sha256').update(bytes).digest('hex'),sha);assert.ok(bytes.toString().includes(text.trimEnd()));
});
const profile={url:'http://127.0.0.1:5491/long-memory',accountId:'account1',deviceId:'device1',name:'My PC'};
function wallContext(){
 const fields={goldContextText:{value:'',dataset:{},dispatchEvent(){}},goldContextTitle:{value:'',dispatchEvent(){}},goldReaderScope:{value:'unchanged'},goldContextStatus:{textContent:''}};
 const c=load('wall.js',{location:{href:profile.url},document:{getElementById:id=>fields[id]},fetch:async url=>({ok:true,json:async()=>url==='/api/status'?{ok:true,local:profile}:{ok:true,modules:{longMemory:true}}})});
 return {c,fields};
}
test('Wall import stages once and never changes scope/opt-in/Save or overwrites a draft',async()=>{
 const {c,fields}=wallContext(),snapshot={text:'historical data',provider:'claude',capturedAt:new Date().toISOString()};
 const result=await c.lightRemoteLmStageWall(profile,snapshot,'gen-1',Date.now()+60000);assert.equal(result.ok,true);assert.equal(fields.goldReaderScope.value,'unchanged');
 fields.goldContextText.value='Owner edited';assert.equal((await c.lightRemoteLmStageWall(profile,snapshot,'gen-1',Date.now()+60000)).duplicate,true);assert.equal(fields.goldContextText.value,'Owner edited');
 assert.equal((await c.lightRemoteLmStageWall(profile,snapshot,'gen-2',Date.now()+60000)).error,'wall_draft_not_empty');
});
test('Wall import checks current identity and absolute expiration before writing',async()=>{
 const {c,fields}=wallContext();
 assert.equal((await c.lightRemoteLmStageWall(profile,{text:'no'},'g',Date.now()-1)).ok,false);assert.equal(fields.goldContextText.value,'');
 assert.equal((await c.lightRemoteLmStageWall({...profile,accountId:'other'},{text:'no'},'g',Date.now()+1000)).error,'wall_identity_changed');assert.equal(fields.goldContextText.value,'');
});
test('restore read validates full-context hash and checks identity/scope again after the read',async()=>{
 const id='11111111-1111-1111-1111-111111111111',fields={goldReaderScope:{value:id}};
 let owner=profile.accountId,corrupt=false,change=false;
 const text='Verified context 😀\n    code',sha256=createHash('sha256').update(text).digest('hex');
 const c=load('wall.js',{location:{href:profile.url},document:{getElementById:key=>fields[key]},fetch:async url=>({ok:true,json:async()=>{
  if(url==='/api/status')return {ok:true,local:{...profile,accountId:owner}};
  if(change)owner='other-account';
  return {ok:true,context:{available:true,scopeId:id,integrity:'full_context_verified',text,sha256:corrupt?'f'.repeat(64):sha256,title:'My work',checkpointRevision:3}};
 }})});
 const result=await c.lightRemoteLmReadMemory(profile,'context');assert.equal(result.ok,true);assert.equal(result.text,text);
 corrupt=true;assert.equal((await c.lightRemoteLmReadMemory(profile,'context')).ok,false);
 corrupt=false;change=true;assert.equal((await c.lightRemoteLmReadMemory(profile,'context')).ok,false);
});
class Textarea{constructor(value=''){this._value=value;this.tagName='TEXTAREA';this.textContent='';this.events=[];}get value(){return this._value;}set value(v){this._value=v;}focus(){}closest(){return null;}getClientRects(){return [{}];}dispatchEvent(e){this.events.push(e.type);}}
test('restore preserves existing drafts, inserts only into one empty composer and never submits',()=>{
 const el=new Textarea('Owner unsent draft'),c=load('restore.js',{location:{href:'https://chatgpt.com/c/draft'},HTMLTextAreaElement:Textarea,getComputedStyle:()=>({}),document:{querySelectorAll:()=>[el]}});
 assert.equal(c.lightRemoteLmStageComposer('context','https://chatgpt.com/c/draft').error,'draft_not_empty');assert.equal(el.value,'Owner unsent draft');
 el.value='';const result=c.lightRemoteLmStageComposer('Unicode 😀\n    code','https://chatgpt.com/c/draft');assert.equal(result.ok,true);assert.equal(result.submitted,false);assert.equal(el.value,'Unicode 😀\n    code');assert.deepEqual(el.events,['input']);
 assert.equal(c.lightRemoteLmStageComposer('other','https://chatgpt.com/c/other').error,'conversation_changed');
});
function background(){
 const state={},local={profile},listeners={},calls={identity:0,stage:0};let resolveIdentity;
 const tab={id:1,url:profile.url,status:'complete'};
 const storage=bag=>({get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).map(k=>[k,bag[k]])),set:async values=>Object.assign(bag,values),remove:async keys=>{for(const k of typeof keys==='string'?[keys]:keys)delete bag[k];},setAccessLevel:async()=>{}});
 const chrome={runtime:{id:'extension1',getURL:p=>'chrome-extension://extension1/'+p,onMessage:{addListener:f=>listeners.message=f},onStartup:{addListener(){}}},permissions:{contains:async()=>true},storage:{session:storage(state),local:storage(local)},alarms:{create(){},onAlarm:{addListener:f=>listeners.alarm=f}},tabs:{
  get:async()=>tab,query:async()=>[],create:async options=>{assert.equal(options.url,'about:blank');return tab;},
  update:async(id,options)=>{assert.equal(state.pendingWall?.tabId,id);assert.equal(state.pendingWall?.url,options.url);tab.url=options.url;listeners.updated(id,{status:'complete'});},
  onUpdated:{addListener:f=>listeners.updated=f},onRemoved:{addListener:f=>listeners.removed=f}},scripting:{executeScript:async({func})=>{
  if(func.name==='lightRemoteLmWallIdentity'){calls.identity++;if(resolveIdentity)await new Promise(resolve=>resolveIdentity=resolve);return [{result:{ok:true,...profile,memoryEnabled:true}}];}
  calls.stage++;return [{result:{ok:true}}];
 }}};
 const c=vm.createContext({...env,chrome});c.importScripts=(...names)=>names.forEach(name=>vm.runInContext(read(name),c));vm.runInContext(read('background.js'),c);
 return {c,state,local,listeners,calls,tab,pause:()=>{resolveIdentity=true;},resume:()=>resolveIdentity(),pending:()=>({tabId:1,generation:'g1',url:profile.url,pair:false,expiresAt:Date.now()+60000,profile,snapshot:{text:'private'}})};
}
test('pair persists the exact target before the tab can finish loading and only accepts the setup sender',async()=>{
 const f=background(),message={type:'LRLM_PAIR_WALL',url:profile.url};
 delete f.local.profile;
 assert.equal(f.listeners.message(message,{id:'extension1',url:'chrome-extension://extension1/popup.html'},()=>assert.fail()),false);
 const reply=await new Promise(resolve=>assert.equal(f.listeners.message(message,{id:'extension1',url:'chrome-extension://extension1/pair.html?wall=fixture'},resolve),true));
 assert.equal(reply.ok,true);
 await f.c.maybePrepare(1);
 assert.equal(f.local.profile.url,profile.url);
 assert.equal(f.state.pairProgress.state,'paired');
 assert.equal(f.calls.identity,1);
});
test('pair only offers sign-in on the selected origin and waits for Long Memory',async()=>{
 const f=background();
 delete f.local.profile;
 f.state.pendingWall={...f.pending(),pair:true};
 f.tab.url='http://127.0.0.1:9999/login';
 await f.c.maybePrepare(1);
 assert.equal(f.state.pairProgress.state,'error');
 assert.equal(f.calls.identity,0);
 f.tab.url='http://127.0.0.1:5491/login?next=%2Flong-memory';
 await f.c.maybePrepare(1);
 assert.equal(f.state.pairProgress.state,'sign_in');
 assert.equal(f.calls.identity,0);
 assert.equal(f.local.profile,undefined);
 f.tab.url=profile.url;
 await f.c.maybePrepare(1);
 assert.equal(f.state.pairProgress.state,'paired');
});
test('background duplicate completion events are single-flight, staging plaintext is removed',async()=>{
 const f=background();f.state.pendingWall=f.pending();const a=f.c.maybePrepare(1),b=f.c.maybePrepare(1);assert.equal(a,b);await a;
 assert.deepEqual(f.calls,{identity:1,stage:1});assert.equal(f.state.pendingWall,undefined);await f.c.maybePrepare(1);assert.equal(f.calls.stage,1);
});
test('background generation changes and TTL prevent stale imports; no expired restore retention',async()=>{
 const f=background();f.state.pendingWall=f.pending();f.pause();const old=f.c.maybePrepare(1);
 for(let i=0;i<12;i++)await Promise.resolve();
 f.state.pendingWall={...f.pending(),generation:'g2'};f.resume();await old;assert.equal(f.calls.stage,0);assert.equal(f.state.pendingWall.generation,'g2');
 f.state.pendingWall.expiresAt=0;f.state.restore={text:'private',expiresAt:0};await f.c.expire();assert.equal(f.state.pendingWall,undefined);assert.equal(f.state.restore,undefined);
});
