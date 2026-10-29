import {WALL_DIALOG_EMBED} from '../lib/wall-dialogs.mjs';
// M6 Fleet Wall owner-scoped job overview, with bounded queued-only cancel.
export function fleetJobPage({csrfToken=''}={}){
 const csrf=JSON.stringify(String(csrfToken));
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Light Remote — Fleet Jobs</title><style>
:root{font:14px system-ui;color-scheme:dark;background:#080a0c;color:#d7e3ef}*{box-sizing:border-box}body{margin:0}
main{max-width:1400px;margin:auto;padding:22px}header{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:23px;margin:8px 0}p,small{color:#9caebf;line-height:1.5}a{color:#6dcaf1}button,select{padding:8px 12px;background:#121c26;color:#e2edf6;border:1px solid #314b63;border-radius:8px;cursor:pointer}
section{border:1px solid #23313f;border-radius:10px;overflow:auto;margin-top:18px}table{width:100%;border-collapse:collapse;min-width:900px}td,th{text-align:left;border-bottom:1px solid #1b2a36;padding:11px}th{color:#9ebbd0;background:#0e1822}code{font-size:12px;color:#b9ddf5}.queued{color:#f0c672}.running{color:#79d4ec}.ok{color:#85daa9}.error{color:#f5a0a0}
@media(max-width:700px){main{padding:12px}td,th{padding:8px}}
</style></head><body><main><header><div><a href="/">← Fleet Wall</a><h1>Jobs & Queue</h1><small>Owner account · all registered devices · owner job overview</small></div><div><select id="filter"><option value="">All states</option><option>running</option><option>queued</option><option>ok</option><option>error</option></select> <button id="refresh">Refresh</button></div></header>
<p>Execution slots, per-device worker budgets and resource locks are independent. A process launch marked OK is not a completed background process. UNKNOWN must not be interpreted as successful execution. Undispatched queued jobs can be canceled. A retained managed process with a verified running lease can receive a graceful Stop request here; this is NOT confirmation of termination. Other running work and Force Stop remain on the authenticated device Local Wall.</p>
<h2>Device worker leases & performance</h2><p>Owner-only PostgreSQL worker claims. Host CPU and RAM are host-level samples; Agent CPU/RSS and filesystem I/O operation counts are Agent-process-only, not total disk throughput. Samples older than 90 seconds are hidden as stale. No automatic unlock on UNKNOWN or aged claims.</p><section><table><thead><tr><th>Device</th><th>Owner weight / configured budget</th><th>Claims</th><th>Managed process leases</th><th>Queued (resource / Agent)</th><th>Over 1h</th><th>Review required</th><th>Oldest lease</th><th>Host CPU</th><th>Host RAM</th><th>Agent CPU/RSS</th><th>Agent I/O</th><th>Sample</th></tr></thead><tbody id="resourceRows"></tbody></table></section><h2>Stale M4 claims — diagnostic only</h2><p>Claims older than one hour are reviewed automatically. Age or missing PID is NOT proof that a process stopped. Only authenticated signed terminal replay or separately audited owner recovery can release an unknown OS effect. This table has no unlock action.</p><section><table><thead><tr><th>Device</th><th>Job</th><th>Age</th><th>Claim state</th><th>Process ID known</th><th>Classification</th><th>Safe next step</th><th>Owner Recovery</th></tr></thead><tbody id="staleRows"></tbody></table></section><section id="ownerRecoveryPanel" hidden aria-label="Owner Recovery" style="padding:16px;background:#0e1c2a;border-color:#b68d42"><h2>Owner Recovery · verified review</h2><p id="ownerRecoverySummary">Review the exact retained claim before proceeding. This records UNKNOWN — never successful termination.</p><div style="display:grid;gap:10px;max-width:630px"><label>Reason <select id="recoveryReason"><option value="gold_agent_reinstalled">Agent reinstalled after claim</option><option value="gold_agent_uninstalled">Agent uninstalled after claim</option></select></label><label>Device restart / reinstall evidence time (local) <input id="recoveryBoot" type="datetime-local"></label><label>Owner account password (required) <input id="recoveryPassword" type="password" autocomplete="current-password"></label><label>Exact owner confirmation <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><code id="recoveryCopyPhrase">ABANDON_UNKNOWN_RESULT</code><button id="recoveryCopy" type="button">Copy</button></span><input id="recoveryConfirm" autocomplete="off" spellcheck="false" placeholder="Paste the exact confirmation above"></label><div><button id="recoverySubmit" type="button">Attest &amp; recover UNKNOWN claim</button> <button id="recoveryCancel" type="button">Cancel</button></div><p id="recoveryMessage" role="status"></p></div></section><p id="status" role="status">Loading…</p><section><table><thead><tr><th>Status</th><th>Device</th><th>Agent</th><th>Job</th><th>Work class</th><th>Queue reason</th><th>Started</th><th>Output</th><th>Action</th></tr></thead><tbody id="rows"></tbody></table></section></main>
<script>
const rows=document.getElementById('rows'),resourceRows=document.getElementById('resourceRows'),staleRows=document.getElementById('staleRows'),message=document.getElementById('status'),filter=document.getElementById('filter'),csrf=${csrf};
let all=[],resources=[],staleClaims=[],staleDiagnosticReady=false;
const cell=(tr,value)=>{const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td);return td};
function render(){staleRows.replaceChildren();for(const s of staleClaims){const tr=document.createElement('tr');cell(tr,s.deviceName||s.deviceId);cell(tr,s.jobId);cell(tr,s.ageMinutes+' min');cell(tr,s.workerState);cell(tr,s.processIdentityKnown?'Yes':'No');cell(tr,s.classification).className='queued';cell(tr,s.nextAction);const recovery=cell(tr,'');if(/^[a-f0-9-]{36}$/i.test(s.jobId)){const b=document.createElement('button');b.textContent='Review Recovery';b.type='button';b.onclick=()=>reviewRecovery(s.deviceId,s.jobId);recovery.append(b)}staleRows.append(tr)}if(!staleClaims.length){const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=8;td.textContent=staleDiagnosticReady?'No stale claims detected in this owner scope.':'Stale claim diagnostics unavailable — no clean result may be inferred.';tr.append(td);staleRows.append(tr)}resourceRows.replaceChildren();for(const r of resources){const tr=document.createElement('tr');cell(tr,r.deviceName||r.deviceId);cell(tr,r.ownerWorkerWeight+' / '+(r.workerBudget??'unknown'));cell(tr,r.claimCount);cell(tr,r.processLeaseCount);cell(tr,r.queuedCount+' ('+r.resourceQueuedCount+' / '+r.agentSlotQueuedCount+')');cell(tr,r.ageWarningCount);const c=cell(tr,r.reviewRequiredCount);if(r.reviewRequiredCount>0)c.className='queued';cell(tr,r.oldestClaimAt?new Date(r.oldestClaimAt).toLocaleString():'—');const m=r.metrics,fmtPct=v=>v==null?'—':v.toFixed(1)+'%',fmtSize=v=>v==null?'—':(v/1024/1024).toFixed(0)+' MiB';cell(tr,fmtPct(m?.hostCpuPercent));cell(tr,m?.hostMemoryTotalBytes!=null?fmtSize(m.hostMemoryUsedBytes)+' / '+fmtSize(m.hostMemoryTotalBytes):'—');cell(tr,fmtPct(m?.agentCpuPercent)+' / '+fmtSize(m?.agentRssBytes));cell(tr,m?.agentFsReadOps!=null||m?.agentFsWriteOps!=null?'R '+(m.agentFsReadOps??'—')+' / W '+(m.agentFsWriteOps??'—')+' ops · Agent only':'—');const status=cell(tr,r.metricsState==='fresh'?'Live · '+(m.windowMs??'—')+' ms':r.metricsState==='stale'?'STALE · no current sample':'UNKNOWN · no sample');if(r.metricsState!=='fresh')status.className='queued';resourceRows.append(tr)}rows.replaceChildren();const found=all.filter(j=>!filter.value||j.status===filter.value);for(const j of found){const tr=document.createElement('tr');cell(tr,j.status).className=['queued','running','ok','error'].includes(j.status)?j.status:'';cell(tr,j.deviceName||j.deviceId);cell(tr,j.agentId);cell(tr,j.jobId);cell(tr,j.workerClass+(j.jobRole==='process_launch'?' · launch':''));
cell(tr,j.queueReason||'—');cell(tr,j.startedAt?new Date(j.startedAt).toLocaleString():'—');cell(tr,j.outputBytes==null?'not retained':String(j.outputBytes)+' B');const action=cell(tr,'');if(j.status==='queued'){const b=document.createElement('button');b.textContent='Cancel queued';b.onclick=()=>cancelQueued(j.jobId);action.append(b)}if(j.stopAvailable){const b=document.createElement('button');b.textContent='Request Stop';b.onclick=()=>requestStop(j.jobId);action.append(b)}if(j.stopRequested)action.textContent=j.stopVerified?'Stopped · signed device receipt verified':j.stopFailed?'Stop failed or unknown · inspect Local Wall':'Stop requested · awaiting terminal receipt';rows.append(tr)}
message.textContent=found.length+' visible jobs · '+all.length+' scoped jobs. PostgreSQL history + current live Operator state.'}
// A single Review click opens a gated recovery workflow; it cannot unlock.
let recoveryTarget=null;
const panel=document.getElementById('ownerRecoveryPanel'),recoveryMessage=document.getElementById('recoveryMessage');
const recoverApi=async data=>{
 const response=await fetch('/api/owner-recovery',{method:'POST',credentials:'same-origin',
  headers:{'content-type':'application/json','x-light-remote-csrf':csrf},body:JSON.stringify(data)});
 const j=await response.json();if(!response.ok||j.ok!==true)throw Error(j.error||'recovery_refused');return j;
};
function closeRecovery(){recoveryTarget=null;panel.hidden=true;document.getElementById('recoveryPassword').value='';
 document.getElementById('recoveryConfirm').value='';document.getElementById('recoveryBoot').value='';}
async function reviewRecovery(deviceId,jobId){
 closeRecovery();recoveryMessage.textContent='Checking exact owner-scoped claim and channel state…';
 try{
  const j=await recoverApi({mode:'inspect',deviceId,jobId});
  if(j.releasePerformed||j.terminalReceiptCreated||j.processOutcome!=='unknown')throw Error('unsafe_recovery_response');
  recoveryTarget={deviceId,jobId,claimedAt:j.claimedAt};panel.hidden=false;
  document.getElementById('ownerRecoverySummary').textContent='Device '+deviceId+' · Job '+jobId+
   ' · Claimed '+new Date(j.claimedAt).toLocaleString()+
   '. This does NOT prove the process stopped. Only proceed if YOU know the Agent was removed/reinstalled AFTER the claim, and device is currently offline. Result remains UNKNOWN.';
  recoveryMessage.textContent='Enter the independently observed restart/reinstall time, confirm the exact phrase and re-authenticate.';
  panel.scrollIntoView({behavior:'smooth',block:'start'});
 }catch(e){recoveryMessage.textContent='Recovery unavailable: '+e.message;message.textContent=recoveryMessage.textContent;}
}
document.getElementById('recoveryCopy').onclick=async()=>{
 try{await navigator.clipboard.writeText('ABANDON_UNKNOWN_RESULT');recoveryMessage.textContent='Copied. Paste into the confirmation field.';}
 catch{recoveryMessage.textContent='Clipboard unavailable. Select the code and copy manually.';}
};
document.getElementById('recoveryCancel').onclick=closeRecovery;
document.getElementById('recoverySubmit').onclick=async event=>{
 if(!recoveryTarget)return;
 const password=document.getElementById('recoveryPassword'),typed=document.getElementById('recoveryConfirm').value;
 const boot=document.getElementById('recoveryBoot').value;
 if(typed!=='ABANDON_UNKNOWN_RESULT'||!password.value||!boot){recoveryMessage.textContent='Exact confirmation, boot time and owner password are all required.';return;}
 const observedBootAtMs=new Date(boot).getTime();
 if(!Number.isSafeInteger(observedBootAtMs)||observedBootAtMs<=new Date(recoveryTarget.claimedAt).getTime()+1000){recoveryMessage.textContent='Reboot/reinstall must occur AFTER this claim. No recovery performed.';return;}
 if(!await wallConfirm('Owner Recovery will release EXACTLY this lease while recording process outcome UNKNOWN. This is NOT proof of process termination. Continue?'))return;
 event.currentTarget.disabled=true;
 try{
  const result=await recoverApi({...recoveryTarget,mode:'abandon',
    reason:document.getElementById('recoveryReason').value,observedBootAtMs,
    confirm:typed,password:password.value});
  if(!result.released||result.processOutcome!=='unknown'||result.terminalReceiptCreated!==false||result.audited!==true)
   throw Error('recovery_audit_unconfirmed');
  closeRecovery();await refresh();message.textContent='Owner Recovery recorded and audited as UNKNOWN for '+result.jobId+'; no terminal ACK forged.';
 }catch(e){password.value='';recoveryMessage.textContent='Recovery refused: '+e.message;}
 finally{event.currentTarget.disabled=false;password.value='';}
};
async function cancelQueued(jobId){if(!await wallConfirm('Cancel this job only if it has not started on the device?'))return;try{const r=await fetch('/api/jobs/cancel',{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':csrf},body:JSON.stringify({jobId})}),value=await r.json();if(!r.ok||!value.ok)throw Error(value.error||'job_cancellation_refused');await refresh();message.textContent='Queued job canceled before device dispatch: '+jobId;}catch(e){message.textContent='Cancel refused: '+e.message}}
async function requestStop(jobId){if(!await wallConfirm('Request a graceful Stop for the verified managed process? This is not proof it has terminated.'))return;try{const r=await fetch('/api/jobs/stop',{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':csrf},body:JSON.stringify({jobId})}),v=await r.json();if(!r.ok||!v.ok)throw Error(v.error||'process_stop_refused');await refresh();message.textContent='Stop requested. Await verified device terminal receipt before any worker lease is released.';}catch(e){message.textContent='Stop refused: '+e.message}}
async function refresh(){const r=await fetch('/api/jobs?limit=200',{cache:'no-store'}),v=await r.json();if(!r.ok||!v.ok)throw Error(v.error||'fleet_jobs_unavailable');all=v.jobs||[];resources=v.resources||[];staleDiagnosticReady=v.staleClaimStatus?.mode==='diagnostic_only'&&v.staleClaimStatus?.available!==false;staleClaims=staleDiagnosticReady?(v.staleClaims||[]):[];render()}
document.getElementById('refresh').onclick=()=>refresh().catch(e=>message.textContent=e.message);
filter.onchange=render;refresh().catch(e=>message.textContent=e.message);
setInterval(()=>{if(!document.hidden)refresh().catch(e=>message.textContent=e.message)},10000);
</script></body></html>`.replace("</body>",WALL_DIALOG_EMBED+"</body>");
}