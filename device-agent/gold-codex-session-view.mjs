// Allowlisted presentation of local app-server metadata. Never expose account
// email/id, loginId, credentials, raw RPC errors, prompts or workspace paths.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ident=x=>typeof x==='string'&&/^[A-Za-z0-9_.:/-]{1,160}$/.test(x);
const label=(x,n=160)=>typeof x==='string'?x.slice(0,n):null;
const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const fail=code=>Object.assign(Error(code),{status:400});
const tokenFields=['totalTokens','inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens'];
function tokens(raw){
 if(!raw||tokenFields.some(k=>count(raw[k])===null))return null;
 return Object.fromEntries(tokenFields.map(k=>[k,raw[k]]));
}
function windowView(raw){
 if(!raw||!Number.isFinite(raw.usedPercent)||raw.usedPercent<0||raw.usedPercent>100)return null;
 return {usedPercent:raw.usedPercent,windowDurationMins:count(raw.windowDurationMins),resetsAt:count(raw.resetsAt)};
}
export function createCodexSessionView({home,now=()=>Date.now()}={}){
 const file=path.join(home,'light-remote-preferences.json');
 let preference={model:null,reasoningEffort:null},preferenceError=false;
 if(fs.existsSync(file)){
  try{
   if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>4096)throw Error('invalid');
   const p=JSON.parse(fs.readFileSync(file,'utf8'));
   if(!ident(p.model)||!ident(p.reasoningEffort))throw Error('invalid');
   preference={model:p.model,reasoningEffort:p.reasoningEffort};
  }catch{preferenceError=true;}
 }

 let owner=null,account={state:'not_checked',connected:false,plan:null},models=[],catalogAt=null,catalogError=null;
 let quota={state:'not_checked',asOf:null,buckets:[],ordinaryUsageAllowed:null};
 let accountUsage={state:'not_checked',asOf:null,lifetimeTokens:null,daily:[]};
 let usage={state:'not_reported',asOf:null,total:null,last:null,model:null,reasoningEffort:null};
 const threads=new Map();
 function resetPrivate(){models=[];catalogAt=null;catalogError=null;threads.clear();quota={state:'not_checked',asOf:null,buckets:[],ordinaryUsageAllowed:null};accountUsage={state:'not_checked',asOf:null,lifetimeTokens:null,daily:[]};usage={state:'not_reported',asOf:null,total:null,last:null,model:null,reasoningEffort:null};}
 function updateAccount(raw){
  const fingerprint=raw?crypto.createHash('sha256').update(JSON.stringify([raw.type,raw.id??raw.email??raw.chatgptAccountId??null])).digest('hex'):null;
  if(!raw||fingerprint!==owner){resetPrivate();owner=fingerprint;}
  account={state:'ready',connected:!!raw&&raw.type!=='apiKey'&&raw.authMode!=='apiKey',plan:label(raw?.planType,40)};
 }
 function applyModels(raw){
  if(!Array.isArray(raw))throw fail('codex_model_catalog_invalid');
  models=raw.filter(m=>m&&m.hidden!==true&&ident(m.model)&&typeof m.displayName==='string').slice(0,100).map(m=>({
   model:m.model,displayName:label(m.displayName),isDefault:m.isDefault===true,
   defaultReasoningEffort:ident(m.defaultReasoningEffort)?m.defaultReasoningEffort:null,
   supportedReasoningEfforts:(Array.isArray(m.supportedReasoningEfforts)?m.supportedReasoningEfforts:[]).filter(e=>ident(e?.reasoningEffort)).slice(0,20).map(e=>({reasoningEffort:e.reasoningEffort,description:label(e.description,240)}))}));
  catalogAt=now();catalogError=null;
 }
 function selection(){
  if(preferenceError||preference.model&&!models.some(m=>m.model===preference.model&&m.supportedReasoningEfforts.some(e=>e.reasoningEffort===preference.reasoningEffort)))return {model:null,reasoningEffort:null,unavailable:true};
  const model=models.find(m=>m.model===preference.model)||models.find(m=>m.isDefault)||models[0];
  if(!model)return {model:null,reasoningEffort:null};
  const effort=model.supportedReasoningEfforts.some(e=>e.reasoningEffort===preference.reasoningEffort)?preference.reasoningEffort:
   model.supportedReasoningEfforts.some(e=>e.reasoningEffort===model.defaultReasoningEffort)?model.defaultReasoningEffort:model.supportedReasoningEfforts[0]?.reasoningEffort??null;
  return {model:model.model,reasoningEffort:effort};
 }
 function select(input){
  const m=models.find(m=>m.model===input?.model);
  if(!m||!m.supportedReasoningEfforts.some(e=>e.reasoningEffort===input.reasoningEffort))throw fail('codex_model_or_effort_unavailable');
  const p={model:m.model,reasoningEffort:input.reasoningEffort},tmp=file+'.tmp';
  for(const n of [file,tmp])if(fs.existsSync(n)&&fs.lstatSync(n).isSymbolicLink())throw fail('codex_preferences_invalid');
  fs.writeFileSync(tmp,JSON.stringify(p)+'\n',{mode:0o600});fs.renameSync(tmp,file);preference=p;preferenceError=false;
  return selection();
 }
 function applyRateLimits(raw){
  const multi=raw?.rateLimitsByLimitId;
  const values=multi&&typeof multi==='object'&&!Array.isArray(multi)?Object.entries(multi):[['codex',raw?.rateLimits]];
  const buckets=values.filter(([,v])=>v&&typeof v==='object').slice(0,32).map(([key,v])=>({
   id:label(v.limitId||key),name:label(v.limitName||v.limitId||key),primary:windowView(v.primary),secondary:windowView(v.secondary),
   reached:label(v.rateLimitReachedType,100)}));
  quota={state:buckets.some(b=>b.primary||b.secondary)?'ready':'unavailable',asOf:now(),buckets,
   ordinaryUsageAllowed:typeof raw?.ordinaryUsageAllowed==='boolean'?raw.ordinaryUsageAllowed:null};
 }
 function applyAccountUsage(raw){
  const lifetimeTokens=count(raw?.summary?.lifetimeTokens);
  const daily=(Array.isArray(raw?.dailyUsageBuckets)?raw.dailyUsageBuckets:[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d?.startDate)&&count(d.tokens)!==null).slice(-31).map(d=>({date:d.startDate,tokens:d.tokens}));
  accountUsage={state:lifetimeTokens!==null||daily.length?'ready':'unavailable',asOf:now(),lifetimeTokens,daily};
 }
 function trackThread(id,config){
  threads.set(id,{...config,total:null});while(threads.size>100)threads.delete(threads.keys().next().value);
 }
 function ingestTokens(params){
  const thread=threads.get(params?.threadId),total=tokens(params?.tokenUsage?.total),last=tokens(params?.tokenUsage?.last);
  if(!thread||!total||!last)return;
  // Notifications contain cumulative totals. Repeated/stale notices cannot
  // inflate counters; the UI labels this as Bridge-observed process usage.
  if(thread.total&&tokenFields.some(k=>total[k]<thread.total[k]))return;
  const sum=usage.total||Object.fromEntries(tokenFields.map(k=>[k,0]));
  for(const k of tokenFields)sum[k]+=total[k]-(thread.total?.[k]||0);
  thread.total=total;usage={state:'ready',asOf:now(),total:sum,last,model:thread.model,reasoningEffort:thread.reasoningEffort};
 }
 return {updateAccount,applyModels,selection,select,applyRateLimits,applyAccountUsage,trackThread,ingestTokens,
  catalogFresh:()=>catalogAt!==null&&now()-catalogAt<60000,
  unavailable(kind){if(kind==='models')catalogError='codex_model_catalog_unavailable';else if(kind==='quota')quota={...quota,state:quota.asOf?'stale':'unavailable'};else accountUsage={...accountUsage,state:accountUsage.asOf?'stale':'unavailable'};},
  disconnected(){account={...account,state:'unavailable',connected:false};},
  snapshot(){return structuredClone({account,catalog:{state:catalogError?(catalogAt?'stale':'unavailable'):catalogAt?'ready':'not_checked',asOf:catalogAt,error:catalogError,models},selection:selection(),quota,accountUsage,usage});}};
}
