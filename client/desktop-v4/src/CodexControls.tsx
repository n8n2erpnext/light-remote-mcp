import {useRef,useState} from 'react';
import {Copy,Check} from 'lucide-react';
import {Button} from './components/ui/button';
import {Card,CardHeading} from './components/ui/card';
import {DetailNote,DateLabel} from './components/ProductUi';
import type {CodexSession} from './lib/codex-session';

export function CodexLoginCode({code,pending,onCancel}:{code:string;pending:boolean;onCancel:()=>void}){
 const input=useRef<HTMLInputElement|null>(null),[copiedCode,setCopiedCode]=useState<string|null>(null);
 const copied=copiedCode===code;
 const copy=async()=>{
  try{await navigator.clipboard.writeText(code);setCopiedCode(code);}
  catch{input.current?.focus();input.current?.select();setCopiedCode(document.execCommand('copy')?code:null);}
 };
 return <div className="codex-login-note" role="status"><strong>Enter this code in your browser</strong><p>This screen updates automatically when sign-in finishes.</p><div className="codex-copy-code"><input ref={input} aria-label="Codex sign-in code" readOnly value={code} onFocus={e=>e.currentTarget.select()}/><Button onClick={()=>void copy()}>{copied?<Check size={17}/>:<Copy size={17}/>} {copied?'Copied':'Copy code'}</Button><Button variant="ghost" disabled={pending} onClick={onCancel}>Cancel sign-in</Button></div></div>;
}
const n=(value:number|null|undefined)=>value===null||value===undefined?'Not reported':value.toLocaleString();
const duration=(minutes:number|null)=>minutes===null?'Usage window':minutes%1440===0?`${minutes/1440} day window`:minutes%60===0?`${minutes/60} hour window`:`${minutes} minute window`;
export function CodexControls({session,pending,onSelect,onRefresh}:{session:CodexSession|null;pending:boolean;onSelect:(model:string,reasoningEffort:string)=>void;onRefresh:()=>void}){
 const models=session?.catalog.models||[],selected=models.find(m=>m.model===session?.selection.model);
 const ready=session?.account.connected===true&&session.catalog.state==='ready';
 const quota=session?.quota,usage=session?.usage,accountUsage=session?.accountUsage;
 return <Card><div className="feature-section-title"><CardHeading description="Choose how Codex works on your next task. Changes save on this PC.">Model &amp; usage</CardHeading><Button variant="ghost" disabled={pending} onClick={onRefresh}>Refresh usage</Button></div>
  <div className="codex-preferences"><label><span>Model</span><select aria-label="Codex model" value={selected?.model||''} disabled={!ready||pending} onChange={e=>{const m=models.find(m=>m.model===e.target.value);const effort=m?.defaultReasoningEffort||m?.supportedReasoningEfforts[0]?.reasoningEffort;if(m&&effort)onSelect(m.model,effort);}}>{!selected&&<option value="">{ready?'Choose a model':'Check your Codex account'}</option>}{models.map(m=><option key={m.model} value={m.model}>{m.displayName}</option>)}</select></label>
   <label><span>Reasoning</span><select aria-label="Codex reasoning effort" value={session?.selection.reasoningEffort||''} disabled={!ready||!selected||pending} onChange={e=>selected&&onSelect(selected.model,e.target.value)}>{!selected&&<option value="">Unavailable</option>}{selected?.supportedReasoningEfforts.map(e=><option key={e.reasoningEffort} value={e.reasoningEffort}>{e.reasoningEffort}</option>)}</select></label></div>
  <p className="muted">{selected?.supportedReasoningEfforts.find(e=>e.reasoningEffort===session?.selection.reasoningEffort)?.description||'Available models and reasoning levels are supplied by your installed Codex runtime.'}</p>
  {session?.catalog.state==='unavailable'&&<p role="status">This runtime could not provide its model list. Refresh the account or update Codex.</p>}
  <div className="codex-usage-grid"><section><h3>ChatGPT plan usage</h3>{quota?.buckets.length?quota.buckets.map(bucket=><div className="codex-quota" key={bucket.id}><strong>{bucket.name}</strong>{[bucket.primary,bucket.secondary].map((w,i)=>w?<div key={i}><div className="codex-quota-label"><span>{duration(w.windowDurationMins)}</span><strong>{w.usedPercent}% used</strong></div><progress aria-label={`${bucket.name} ${duration(w.windowDurationMins)}`} max={100} value={w.usedPercent}/><small className="muted">Resets {w.resetsAt?<DateLabel value={w.resetsAt*1000}/>: 'not reported'}</small></div>:null)}{bucket.reached&&<p role="status">A usage limit has been reported. Check your account before starting more work.</p>}</div>):<p className="muted">Quota has not been reported by Codex. Select Check account or Refresh usage.</p>}{quota?.state==='stale'&&<p role="status">Last known usage. Refresh is currently unavailable.</p>}</section>
   <section><h3>Token usage</h3><div className="feature-pairs"><div><span>Codex work on this PC</span><strong>{n(usage?.total?.totalTokens)}</strong></div><div><span>Last reported turn</span><strong>{n(usage?.last?.totalTokens)}</strong></div><div><span>Account lifetime · reported by Codex</span><strong>{n(accountUsage?.lifetimeTokens)}</strong></div></div><p className="muted">Token counts and plan limits are separate. This PC counts work since its Agent last started.</p>
    <DetailNote title="Token breakdown"><div className="feature-pairs">{(['inputTokens','cachedInputTokens','outputTokens','reasoningOutputTokens'] as const).map(k=><div key={k}><span>{({inputTokens:'Input',cachedInputTokens:'Cached input',outputTokens:'Output',reasoningOutputTokens:'Reasoning output'})[k]}</span><strong>{n(usage?.total?.[k])}</strong></div>)}</div><p>Last token report <DateLabel value={usage?.asOf}/></p>{accountUsage?.daily.map(d=><p key={d.date}>{d.date}: {n(d.tokens)} tokens</p>)}</DetailNote>
   </section></div>
 </Card>;
}
