// This script only displays allowlisted metadata from the existing Owner-only
// Wall API. Model changes use the same CSRF-protected preferences controller.
export const WALL_CODEX_CONTROLS=String.raw`
let goldCodexLive=false,goldCodexStatusBusy=false;
const codexMetrics=document.createElement('section');codexMetrics.className='codex-work-options';
codexMetrics.innerHTML='<h3>Model &amp; usage</h3><p class="muted">Choose settings for your next Codex task. Values come from this device’s Codex runtime.</p><div class="codex-option-row"><label>Model <select id="goldCodexModel" aria-label="Codex model" disabled></select></label><label>Reasoning <select id="goldCodexEffort" aria-label="Codex reasoning effort" disabled></select></label><button type="button" class="btn" id="goldCodexUsageRefresh">Refresh usage</button></div><div id="goldCodexMetrics" role="status">Check your Codex account to load models and usage.</div>';
document.getElementById('goldCodexPlusOutput').after(codexMetrics);
const codexStyle=document.createElement('style');codexStyle.textContent='.codex-work-options{border-top:1px solid #354653;margin-top:18px;padding-top:16px}.codex-option-row{display:flex;flex-wrap:wrap;gap:16px;align-items:end}.codex-option-row label{display:grid;gap:7px;min-width:150px;flex:1}.codex-option-row select{width:100%;max-width:100%}.codex-quota-row{display:grid;gap:6px;margin:12px 0}.codex-quota-row progress{width:min(100%,500px);accent-color:#dfb900}#goldCodexPlusCode{font:700 20px "Google Sans Code",monospace;letter-spacing:.07em;user-select:text;-webkit-user-select:text;max-width:100%;width:13em}';document.head.appendChild(codexStyle);
let codexCurrent=null;
function goldCodexMetrics(session){
 codexCurrent=session||null;const model=document.getElementById('goldCodexModel'),effort=document.getElementById('goldCodexEffort'),out=document.getElementById('goldCodexMetrics');
 const active=document.activeElement; // do not disturb an open native select
 if(active!==model&&active!==effort){
  model.replaceChildren();effort.replaceChildren();
  const models=session?.catalog?.models||[];
  for(const m of models){const option=document.createElement('option');option.value=m.model;option.textContent=m.displayName;model.append(option);}
  model.value=session?.selection?.model||'';
  const selected=models.find(m=>m.model===model.value);
  for(const e of selected?.supportedReasoningEfforts||[]){const option=document.createElement('option');option.value=e.reasoningEffort;option.textContent=e.reasoningEffort;option.title=e.description||'';effort.append(option);}
  effort.value=session?.selection?.reasoningEffort||'';
 }
 model.disabled=effort.disabled=!(session?.account?.connected&&session?.catalog?.state==='ready');
 out.replaceChildren();
 const paragraph=text=>{const p=document.createElement('p');p.textContent=text;out.append(p);};
 const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'Not reported';
 paragraph('Bridge tokens in this Agent process: '+count(session?.usage?.total?.totalTokens)+' · Last turn: '+count(session?.usage?.last?.totalTokens));
 paragraph('Account lifetime tokens reported by Codex: '+count(session?.accountUsage?.lifetimeTokens));
 paragraph('Bridge counts cover only work observed here and restart with the Agent. Token counts are separate from plan limits.');
 const buckets=session?.quota?.buckets||[];
 if(!buckets.length)paragraph('Quota is not reported yet. Check your Codex account or refresh usage.');
 for(const b of buckets)for(const w of [b.primary,b.secondary])if(w){
  const row=document.createElement('div');row.className='codex-quota-row';const title=document.createElement('strong');
  title.textContent=b.name+' · '+(w.windowDurationMins==null?'Usage window':w.windowDurationMins%60===0?w.windowDurationMins/60+' hour window':w.windowDurationMins+' minute window')+' · '+w.usedPercent+'% used';
  const progress=document.createElement('progress');progress.max=100;progress.value=w.usedPercent;progress.setAttribute('aria-label',title.textContent);
  const reset=document.createElement('small');reset.textContent='Resets '+(w.resetsAt?new Date(w.resetsAt*1000).toLocaleString():'not reported');row.append(title,progress,reset);out.append(row);
 }
 if(session?.quota?.state==='stale')paragraph('Last known quota. Refresh is currently unavailable.');
}
async function goldCodexSelect(model,reasoningEffort){
 const m=document.getElementById('goldCodexModel'),e=document.getElementById('goldCodexEffort');m.disabled=e.disabled=true;
 try{await wallMutation('__LR_CODEX_PREFERENCES__',{model,reasoningEffort});await goldCodexPlusRefresh();}
 catch(error){notify('Could not save Codex settings. Refresh and choose an available model.','error');goldCodexMetrics(codexCurrent);}
}
document.getElementById('goldCodexModel').onchange=event=>{const m=codexCurrent?.catalog?.models?.find(m=>m.model===event.target.value);const e=m?.defaultReasoningEffort||m?.supportedReasoningEfforts?.[0]?.reasoningEffort;if(m&&e)void goldCodexSelect(m.model,e);};
document.getElementById('goldCodexEffort').onchange=event=>void goldCodexSelect(document.getElementById('goldCodexModel').value,event.target.value);
document.getElementById('goldCodexUsageRefresh').onclick=()=>goldCodexPlusRefresh().catch(()=>notify('Codex usage is unavailable.','error'));
document.getElementById('goldCodexPlusCopy').onclick=()=>copyText(document.getElementById('goldCodexPlusCode').value,'Sign-in code copied');
document.getElementById('goldCodexPlusCode').onfocus=event=>event.target.select();
setInterval(()=>{if(location.pathname==='/codex-cli'&&!document.hidden&&goldCodexLive&&!goldCodexStatusBusy)void goldCodexPlusRefresh().catch(()=>{});},2500);
`;
