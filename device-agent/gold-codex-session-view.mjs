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
 if(!raw||!tokenFields.some(k=>count(raw[k])!==null))return null;
 return Object.fromEntries(tokenFields.map(k=>[k,count(raw[k])]));
}
function windowView(raw,asOf){
 if(!raw||!Number.isFinite(raw.usedPercent)||raw.usedPercent<0||raw.usedPercent>100)return null;
 return {usedPercent:raw.usedPercent,remainingPercent:100-raw.usedPercent,windowDurationMins:count(raw.windowDurationMins),resetsAt:count(raw.resetsAt),asOf};
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

 let accountEpoch=0;
 let owner=null,account={state:'not_checked',connected:false,plan:null},models=[],catalogAt=null,catalogError=null;
 let quota={state:'not_checked',asOf:null,buckets:[],ordinaryUsageAllowed:null};
 let accountUsage={state:'not_checked',asOf:null,lifetimeTokens:null,daily:[]};
 let usage={state:'not_reported',asOf:null,total:null,last:null,model:null,reasoningEffort:null};
 const threads=new Map();
 function resetPrivate(){models=[];catalogAt=null;catalogError=null;threads.clear();quota={state:'not_checked',asOf:null,buckets:[],ordinaryUsageAllowed:null};accountUsage={state:'not_checked',asOf:null,lifetimeTokens:null,daily:[]};usage={state:'not_reported',asOf:null,total:null,last:null,model:null,reasoningEffort:null};}
 function updateAccount(raw){
  const fingerprint=raw?crypto.createHash('sha256').update(JSON.stringify([raw.type,raw.id??raw.email??raw.chatgptAccountId??null])).digest('hex'):null;
  if(!raw||fingerprint!==owner){resetPrivate();owner=fingerprint;accountEpoch++;}
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
 function applyRateLimits(raw,{replace=true}={}){
  const source=replace?'account/rateLimits/read':'account/rateLimits/updated',at=now(),multi=raw?.rateLimitsByLimitId;
  const values=multi&&typeof multi==='object'&&!Array.isArray(multi)?Object.entries(multi):[[raw?.rateLimits?.limitId||'codex',raw?.rateLimits]];
  const map=new Map(replace?[]:quota.buckets.map(b=>[b.id,b]));
  for(const [key,v] of values.slice(0,32)){
   if(!v||typeof v!=='object')continue;
   const id=label(v.limitId||key),old=map.get(id);
   const window=name=>Object.hasOwn(v,name)?windowView(v[name],at):replace?null:old?.[name]??null;
   map.set(id,{id,name:label(v.limitName||old?.name||v.limitId||key),primary:window('primary'),secondary:window('secondary'),
    reached:Object.hasOwn(v,'rateLimitReachedType')?label(v.rateLimitReachedType,100):old?.reached??null,asOf:at,source});
  }
  const buckets=[...map.values()].slice(0,32);
  quota={state:buckets.some(b=>b.primary||b.secondary)?'ready':'unavailable',asOf:at,buckets,source,
   ordinaryUsageAllowed:typeof raw?.ordinaryUsageAllowed==='boolean'?raw.ordinaryUsageAllowed:replace?null:quota.ordinaryUsageAllowed};
 }
 function applyAccountUsage(raw){
  const lifetimeTokens=count(raw?.summary?.lifetimeTokens);
  const daily=(Array.isArray(raw?.dailyUsageBuckets)?raw.dailyUsageBuckets:[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d?.startDate)&&count(d.tokens)!==null).slice(-31).map(d=>({date:d.startDate,tokens:d.tokens}));
  accountUsage={state:lifetimeTokens!==null||daily.length?'ready':'unavailable',asOf:now(),source:'account/usage/read',lifetimeTokens,daily};
 }
 function trackThread(id,config){
  threads.set(id,{...config,total:null});while(threads.size>100)threads.delete(threads.keys().next().value);
 }
 function ingestTokens(params){
  const thread=threads.get(params?.threadId),total=tokens(params?.tokenUsage?.total),last=tokens(params?.tokenUsage?.last);
  if(!thread||(!total&&!last))return;
  if(total&&thread.total&&tokenFields.some(k=>total[k]!==null&&thread.total[k]!=null&&total[k]<thread.total[k]))return;
  const sum=usage.total||Object.fromEntries(tokenFields.map(k=>[k,null]));
  if(total){
   for(const k of tokenFields)if(total[k]!==null){const value=(sum[k]??0)+total[k]-(thread.total?.[k]??0);sum[k]=count(value);}
   thread.total=Object.fromEntries(tokenFields.map(k=>[k,total[k]??thread.total?.[k]??null]));
  }
  thread.complete=!!total&&tokenFields.every(k=>total[k]!==null);
  const partial=[...threads.values()].some(t=>!t.complete)||tokenFields.some(k=>sum[k]===null);
  usage={state:partial?'partial':'ready',asOf:now(),source:'thread/tokenUsage/updated',total:sum,last,
   model:thread.model,reasoningEffort:thread.reasoningEffort};
 }
 return {updateAccount,identityEpoch:()=>accountEpoch,
  invalidateAccount(){accountEpoch++;resetPrivate();account={state:'checking',connected:false,plan:null};},applyModels,selection,select,applyRateLimits,applyAccountUsage,trackThread,ingestTokens,
  catalogFresh:()=>catalogAt!==null&&now()-catalogAt<60000,
  unavailable(kind){if(kind==='models')catalogError='codex_model_catalog_unavailable';else if(kind==='quota')quota={...quota,state:quota.asOf?'stale':'unavailable'};else accountUsage={...accountUsage,state:accountUsage.asOf?'stale':'unavailable'};},
  disconnected(){accountEpoch++;owner=null;resetPrivate();account={state:'unavailable',connected:false,plan:null};},
  snapshot(){return structuredClone({account,catalog:{state:catalogError?(catalogAt?'stale':'unavailable'):catalogAt?'ready':'not_checked',asOf:catalogAt,error:catalogError,models},selection:selection(),quota,accountUsage,usage});}};
}
