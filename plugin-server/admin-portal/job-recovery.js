// Bootstrap administrator only. The backend, not the browser, decides eligibility.
let jobRecoveryCache=[];
function recoveryRow(item,canRetire){
 const id=esc(item.jobId),name=esc(item.deviceName||item.deviceId);
 const date=esc(fmtWhen(item.claimedAt));
 const status=item.terminalAckPresent?'signed terminal ACK present':
   item.connectionLeaseActive?'lease present — GC rechecks channel':'offline candidate';
 return '<div class="admin-account-row"><div class="admin-account-info">'+
  '<div class="device-name">'+name+' <span class="badge">'+esc(item.workerState||'unknown')+'</span></div>'+
  '<div class="device-sub">Job '+id+' · '+esc(item.jobStatus||'unknown')+' · '+
   esc(item.deviceState||'unknown')+' · since '+date+'</div>'+
  '<div class="device-sub">Account '+esc(item.accountId)+' · device '+esc(item.deviceId)+
   ' · '+esc(status)+' · process identity '+(item.processIdentityKnown?'known':'unknown')+'</div></div>'+
  '<button class="btn'+(canRetire?' danger':'')+'" type="button" data-retire-stale-job="'+id+'"'+
   (!canRetire||item.terminalAckPresent?' disabled':'')+'>Review / retire</button></div>';
}
async function loadJobRecovery(){
 jobRecoveryMessage.textContent='';
 const jobId=jobRecoveryFilter.value.trim();
 if(jobId&&!/^[a-f0-9-]{36}$/i.test(jobId)){
  jobRecoveryMessage.textContent='Enter a valid job UUID or leave the filter empty.';return;
 }
 const response=await api('job-recovery',{jobId});
 jobRecoveryCache=response.items||[];
 jobRecoveryStatus.textContent=(response.workerEnabled?'GC worker enabled':'GC worker disabled')+
  ' · Gold schema '+response.schemaVersion+
  ' · manual retire '+(response.canRetire?'available':'unavailable')+
  (response.reason?' ('+response.reason+')':'')+' · claims '+String(response.summary?.claims??'—')+
  ' · unknown '+String(response.summary?.unknown??'—')+' · queued '+String(response.summary?.queued??'—')+
  ' · running '+String(response.summary?.running??'—')+' · unresolved fences '+
  String(response.summary?.unresolvedFences??'not installed');
 jobRecoveryRows.innerHTML=jobRecoveryCache.map(row=>recoveryRow(row,response.canRetire)).join('')||
  '<div class="empty">No matching outstanding M4 claims.</div>';
 jobRecoveryRows.querySelectorAll('[data-retire-stale-job]').forEach(button=>button.onclick=async()=>{
  const item=jobRecoveryCache.find(x=>x.jobId===button.dataset.retireStaleJob);
  if(!item)return;
  const reason=prompt('Admin audit reason for retiring the exact job '+item.jobId+' (minimum 8 characters):','Stale offline M4 claim');
  if(reason===null)return;
  if(reason.trim().length<8||reason.length>300){jobRecoveryMessage.textContent='Reason must be 8–300 characters.';return}
  const confirmText=prompt('This retires the server claim as UNKNOWN and keeps an unresolved execution fence. Type RETIRE_UNKNOWN_WITH_FENCE to continue.','');
  if(confirmText!=='RETIRE_UNKNOWN_WITH_FENCE'){jobRecoveryMessage.textContent='Manual recovery cancelled.';return}
  button.disabled=true;
  try{
   const response=await api('job-recovery-retire',{method:'POST',
    body:JSON.stringify({jobId:item.jobId,confirm:confirmText,reason:reason.trim()})});
   await loadJobRecovery();
   jobRecoveryMessage.textContent=response.retired?
    'Claim retired as UNKNOWN with audit and persistent fence. No terminal ACK was invented.':
    'Recovery not performed: '+String(response.reason||'eligibility changed');
  }catch(error){jobRecoveryMessage.textContent=error.message}
  finally{button.disabled=false}
 });
}
document.getElementById('refreshJobRecovery').onclick=()=>loadJobRecovery().catch(e=>jobRecoveryMessage.textContent=e.message);
document.getElementById('jobRecoverySearch').onclick=()=>loadJobRecovery().catch(e=>jobRecoveryMessage.textContent=e.message);
document.getElementById('jobRecoveryFilter').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();loadJobRecovery().catch(err=>jobRecoveryMessage.textContent=err.message)}};
