export const WALL_HISTORY_CONTROLS=String.raw`
// A bounded view is not a total-history limit. Older pages stay on device disk.
let wallHistoryMode='live',wallHistoryBefore=null,wallHistoryPageCursor=null,wallHistoryBusy=false,wallHistoryEpoch=0;
let wallHistoryPending=[],wallHistoryOverflow=false;const wallHistoryBack=[];
const historyBar=document.createElement('div');historyBar.className='controls wall-history-controls';historyBar.style.cssText='padding:10px 12px;border-top:1px solid #25313d';
historyBar.innerHTML='<button type="button" class="btn small" id="wallHistoryNewer" disabled>Newer activity</button><button type="button" class="btn small" id="wallHistoryOlder" disabled>Older activity</button><button type="button" class="btn small" id="wallHistoryLive">Live activity</button><span id="wallHistoryMessage" class="muted" role="status">Loading retained history…</span>';
box.after(historyBar);
const historyMessage=document.getElementById('wallHistoryMessage');
function wallHistoryButtons(){document.getElementById('wallHistoryOlder').disabled=wallHistoryBusy||!wallHistoryBefore;document.getElementById('wallHistoryNewer').disabled=wallHistoryBusy||!wallHistoryBack.length;document.getElementById('wallHistoryLive').disabled=wallHistoryBusy;}
function wallDeferEvent(event){
 if(wallHistoryBusy){if(wallHistoryPending.length<1000)wallHistoryPending.push(event);else wallHistoryOverflow=true;return true;}
 if(wallHistoryMode==='history'){historyMessage.textContent='Earlier activity · new live activity is available';return true;}
 return false;
}
function wallTrimJobs(){
 const completed=[...jobs.values()].filter(j=>!['running','queued','stopping'].includes(j.status));
 for(const row of completed.slice(0,Math.max(0,completed.length-250))){jobs.delete(row.jobId);dirtyJobs.delete(row.jobId);document.getElementById('j-'+row.jobId)?.remove();}
 // Keep active jobs plus a 250-row moving window. No fixed job-count ceiling
 // stops ingestion. Cursor follows the oldest retained completed row.
 const oldest=[...jobs.values()].find(j=>!['running','queued','stopping'].includes(j.status)&&j.historyCursor);
 if(oldest?.historyCursor)wallHistoryBefore=oldest.historyCursor;
 wallHistoryButtons();
}
async function wallHistoryLoad(before=null,mode='live'){
 if(wallHistoryBusy)return false;
 wallHistoryBusy=true;wallHistoryPending=[];wallHistoryOverflow=false;wallHistoryButtons();const epoch=++wallHistoryEpoch;
 historyMessage.textContent='Loading activity from this PC…';
 try{
  const response=await fetch('__LR_HISTORY__?limit=700'+(before?'&before='+encodeURIComponent(before):''),{cache:'no-store',credentials:'same-origin'});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'activity_history_unavailable');
  if(epoch!==wallHistoryEpoch)return false;
  wallHistoryMode=mode;wallHistoryPageCursor=before;wallHistoryBefore=data.nextCursor||null;
  jobs.clear();dirtyJobs.clear();seenEvents.clear();seenOrder.length=0;box.replaceChildren();
  for(const e of data.events||[])ingest(e,false);
  if(renderTimer){clearTimeout(renderTimer);renderTimer=null;}flushRenders();
  historyMessage.textContent=(mode==='live'?'Live activity':'Earlier activity')+' · '+(wallHistoryBefore?'older history available':'start of retained history')+' · storage follows Activity history settings';
  if(data.warning)historyMessage.textContent='Some activity could not be saved on this PC. Check Activity history storage; live events can still arrive.';
  return true;
 }catch(error){
  historyMessage.textContent=String(error.message)==='activity_history_cursor_expired'?'That history page is no longer retained. Select Live activity to refresh.':'Retained history is unavailable. Live events can still arrive; retry or check local history storage.';
  return false;
 }finally{
  wallHistoryBusy=false;
  if(wallHistoryMode==='live'){const queued=wallHistoryPending;wallHistoryPending=[];for(const e of queued)ingest(e,true);}
  else if(wallHistoryPending.length)historyMessage.textContent='Earlier activity · new live activity is available';
  if(wallHistoryOverflow)historyMessage.textContent='More activity arrived while loading. Select Live activity to read the latest retained page.';
  wallHistoryPending=[];wallHistoryButtons();
 }
}
document.getElementById('wallHistoryOlder').onclick=async()=>{const prior={cursor:wallHistoryPageCursor,mode:wallHistoryMode};if(await wallHistoryLoad(wallHistoryBefore,'history'))wallHistoryBack.push(prior);wallHistoryButtons();};
document.getElementById('wallHistoryNewer').onclick=async()=>{const prior=wallHistoryBack.at(-1);if(prior&&await wallHistoryLoad(prior.cursor,prior.mode))wallHistoryBack.pop();wallHistoryButtons();};
document.getElementById('wallHistoryLive').onclick=async()=>{if(await wallHistoryLoad(null,'live'))wallHistoryBack.length=0;wallHistoryButtons();};
`;
