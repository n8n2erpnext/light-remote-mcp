export type TokenCounts=Readonly<{totalTokens:number;inputTokens:number;cachedInputTokens:number;outputTokens:number;reasoningOutputTokens:number}>;
export type CodexModel=Readonly<{model:string;displayName:string;isDefault:boolean;defaultReasoningEffort:string|null;supportedReasoningEfforts:ReadonlyArray<{reasoningEffort:string;description:string|null}>}>;
type WindowUsage=Readonly<{usedPercent:number;windowDurationMins:number|null;resetsAt:number|null}>;
export type CodexSession=Readonly<{
 account:{state:string;connected:boolean;plan:string|null};login:{state:string;userCode:string}|null;
 catalog:{state:string;asOf:number|null;models:ReadonlyArray<CodexModel>};selection:{model:string|null;reasoningEffort:string|null};
 quota:{state:string;asOf:number|null;buckets:ReadonlyArray<{id:string;name:string;primary:WindowUsage|null;secondary:WindowUsage|null;reached:string|null}>};
 accountUsage:{state:string;asOf:number|null;lifetimeTokens:number|null;daily:ReadonlyArray<{date:string;tokens:number}>};
 usage:{state:string;asOf:number|null;total:TokenCounts|null;last:TokenCounts|null;model:string|null;reasoningEffort:string|null};
}>;
const object=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const text=(x:unknown,max=160)=>typeof x==='string'&&x.length<=max?x:null;
const count=(x:unknown)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0?x:null;
const rows=(x:unknown,max:number)=>Array.isArray(x)&&x.length<=max?x:[];
const tokens=(x:unknown):TokenCounts|null=>{
 const r=object(x),keys=['totalTokens','inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens'] as const;
 return keys.every(k=>count(r[k])!==null)?Object.fromEntries(keys.map(k=>[k,r[k]])) as TokenCounts:null;
};
const windowUsage=(x:unknown):WindowUsage|null=>{
 const r=object(x);return typeof r.usedPercent==='number'&&Number.isFinite(r.usedPercent)&&r.usedPercent>=0&&r.usedPercent<=100?
 {usedPercent:r.usedPercent,windowDurationMins:count(r.windowDurationMins),resetsAt:count(r.resetsAt)}:null;
};
export function projectCodexSession(input:unknown):CodexSession|null{
 if(input===null||input===undefined)return null;
 const r=object(input),a=object(r.account),c=object(r.catalog),s=object(r.selection),q=object(r.quota),u=object(r.usage),au=object(r.accountUsage),l=object(r.login);
 if(!text(a.state,40)||!text(c.state,40)||!text(q.state,40)||!text(u.state,40)||!text(au.state,40))return null;
 return {
  account:{state:String(a.state),connected:a.connected===true,plan:text(a.plan,40)},
  login:l.state==='pending'&&text(l.userCode,48)&&a.connected!==true?{state:'pending',userCode:String(l.userCode)}:null,
  catalog:{state:String(c.state),asOf:count(c.asOf),models:rows(c.models,100).flatMap(raw=>{
   const m=object(raw);if(!text(m.model)||!text(m.displayName))return [];
   return [{model:String(m.model),displayName:String(m.displayName),isDefault:m.isDefault===true,defaultReasoningEffort:text(m.defaultReasoningEffort),supportedReasoningEfforts:rows(m.supportedReasoningEfforts,20).flatMap(raw=>{const e=object(raw);return text(e.reasoningEffort)?[{reasoningEffort:String(e.reasoningEffort),description:text(e.description,240)}]:[];})}];
  })},selection:{model:text(s.model),reasoningEffort:text(s.reasoningEffort)},
  quota:{state:String(q.state),asOf:count(q.asOf),buckets:rows(q.buckets,32).flatMap(raw=>{const b=object(raw);return text(b.id)&&text(b.name)?[{id:String(b.id),name:String(b.name),primary:windowUsage(b.primary),secondary:windowUsage(b.secondary),reached:text(b.reached,100)}]:[];})},
  accountUsage:{state:String(au.state),asOf:count(au.asOf),lifetimeTokens:count(au.lifetimeTokens),daily:rows(au.daily,31).flatMap(raw=>{const d=object(raw);return /^\d{4}-\d{2}-\d{2}$/.test(String(d.date))&&count(d.tokens)!==null?[{date:String(d.date),tokens:Number(d.tokens)}]:[];})},
  usage:{state:String(u.state),asOf:count(u.asOf),total:tokens(u.total),last:tokens(u.last),model:text(u.model),reasoningEffort:text(u.reasoningEffort)}
 };
}
