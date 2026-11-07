import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
const reqId='av2_'+'c'.repeat(32);
let ownerApproved=0, lastSent=null;
const auth={enabled:true,
 identity:req=>req.headers['x-test-owner']==='owner'?{username:'owner@example.invalid'}:null,
 csrfForRequest:()=> 'fixture-csrf-t11',
 verifyRequestCsrf:(req,token)=>token==='fixture-csrf-t11'&&
  req.headers['x-light-remote-csrf']==='fixture-csrf-t11'
};
const wall=startLocalWall({
 host:'127.0.0.1',port:0,auth,
 getLocalStatus:async()=>({cloudDesiredConnected:true,cloudState:'connected'}),
 getRemoteStatus:async()=>({ok:true,pairingMode:'abv2_only'}),
 getAbV2Pending:async()=>({ok:true,ownerApproveEnabled:true,
  ownerConsentRequired:true,pending:[{requestId:reqId,attempt:1,expiresAt:Date.now()+120000,
    aCode:'ABCD02-GHFDX'}]}),
 getAbV2Approve:async payload=>{
  ownerApproved++;
  assert.equal(payload.wallUsername,'owner@example.invalid');
  assert.equal(payload.requestId,reqId);
  assert.equal(payload.expectedAttempt,1);
  assert.equal(payload.bCode,'ABCD-2345');
  assert.equal(payload.consentCode,'a'.repeat(32));
  return {ok:true,state:'granted',requestId:reqId,agentId:'agent1'};
 }
});
class Element{
 constructor(tag='div'){this.tag=tag;this.children=[];this.style={};this.dataset={};
  this.attributes={};this.className='';this.textContent='';this.value='';this.disabled=false;
  this.classList={contains:v=>this.className.split(' ').includes(v)};}
 append(...elements){this.children.push(...elements)}
 replaceChildren(...elements){this.children=[...elements]}
 setAttribute(key,value){this.attributes[key]=value}
 getAttribute(key){return this.attributes[key]??null}
 addEventListener(key,handler){this['on'+key]=handler}
 contains(node){return this.children.includes(node)||this.children.some(c=>c.contains?.(node))}
 focus(){} select(){}
}
const ids=Object.fromEntries(['abV2OwnerPreview','abV2PreviewRefresh','abV2PreviewState',
 'abV2PreviewStatus','abV2PreviewItems'].map(id=>[id,new Element()]));
const document={hidden:false,activeElement:null,
 getElementById:id=>ids[id]||null,createElement:tag=>new Element(tag),
 querySelector:()=>null};
const all=node=>[node,...node.children.flatMap(all)];
try{
 if(!wall.server.listening)await new Promise(r=>wall.server.once('listening',r));
 const root='http://127.0.0.1:'+wall.server.address().port;
 const html=await (await fetch(root+'/approve',{headers:{'x-test-owner':'owner'}})).text();
 assert.match(html,/id="abV2OwnerPreview"/);
 assert.doesNotMatch(html,/id="lookup"|id="legacyApproveCard"/);
 const scripts=[...html.matchAll(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)]
  .map(x=>x[1].trim()).filter(Boolean);
 const tokenScript=scripts.find(x=>x.startsWith('const wallCsrf='));
 const approvalScript=scripts.find(x=>x.includes("fetch('/api/abv2/approve'"));
 assert.ok(tokenScript&&approvalScript,'V2 only page must include standalone token and approval script');
 const localFetch=async(path,options={})=>{
  const headers={...(options.headers||{}),'x-test-owner':'owner'};
  if(path==='/api/abv2/approve')lastSent={headers,body:JSON.parse(options.body)};
  return fetch(root+path,{...options,headers});
 };
 const context=vm.createContext({document,window:{lrWebConfirm:async()=>true},
  fetch:localFetch,setInterval:()=>0,Date,console});
 new vm.Script(tokenScript,{filename:'rendered-owner-csrf.js'}).runInContext(context);
 new vm.Script(approvalScript,{filename:'rendered-approval-click.js'}).runInContext(context);
 for(let i=0;i<30&&!ids.abV2PreviewItems.children.length;i++)
  await new Promise(r=>setTimeout(r,10));
 assert.ok(ids.abV2PreviewItems.children.length,'signed request list actually populated DOM');
 const elements=all(ids.abV2PreviewItems);
 const chars=elements.filter(e=>e.className==='ab2-digit');
 assert.equal(chars.length,8);
 'ABCD2345'.split('').forEach((v,i)=>{chars[i].value=v});
 const consent=elements.find(e=>e.attributes['aria-label']==='Owner account-verified one-time consent');
 assert.ok(consent);consent.value='a'.repeat(32);
 const approve=elements.find(e=>e.tag==='button'&&e.textContent.includes('Approve Agent'));
 assert.ok(approve&&typeof approve.onclick==='function');
 await approve.onclick();
 assert.equal(ownerApproved,1,'real HTTP Owner handler receives exactly one authorized click');
 assert.equal(lastSent.headers['x-light-remote-csrf'],'fixture-csrf-t11',
  'header from rendered JavaScript, no test-injected CSRF');
 assert.equal(lastSent.body.requestId,reqId);
 assert.equal((await fetch(root+'/api/abv2/approve',{method:'POST',
  headers:{'x-test-owner':'owner','content-type':'application/json',
   'x-light-remote-csrf':'invalid'},
  body:JSON.stringify(lastSent.body)})).status,403,'invalid CSRF still denied');
 assert.equal(ownerApproved,1);
 const forbidden=await fetch(root+'/api/abv2/approve',{method:'POST',
  headers:{'content-type':'application/json','x-light-remote-csrf':'fixture-csrf-t11'},
  body:JSON.stringify(lastSent.body)});
 assert.equal(forbidden.status,401,'wrong/no owner still denied');
 assert.equal(ownerApproved,1);
 console.log('T11_RENDERED_WALL_CLICK_CSRF_OWNER_GATES=PASS');
}finally{await wall.close();}
const refinement=fs.readFileSync(new URL('../../device-agent/wall-ui-refinement.mjs',import.meta.url),'utf8');
assert.match(refinement,/\.term \.commandrow\{grid-template-columns:max-content minmax\(0,1fr\) auto;grid-template-areas:"lead command actions"/);
assert.match(refinement,/@media\(max-width:800px\)\{\.term \.commandrow\{grid-template-columns:minmax\(0,1fr\);grid-template-areas:"lead" "command" "actions"/);
assert.doesNotMatch(refinement,/grid-template-columns:58px 86px/);
console.log('T11_WALL_THREE_REGION_DESKTOP_MOBILE_CSS_CONTRACT=PASS');
