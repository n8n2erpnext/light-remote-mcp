import {WALL_DIALOG_EMBED} from '../lib/wall-dialogs.mjs';
import {brandFaviconSvg} from '../lib/brand.mjs';
import {materialIcon} from '../lib/material-icon.mjs';
import {WALL_FONT_FACE_CSS,WALL_UI_FONT,WALL_CODE_FONT,WALL_TYPOGRAPHY_CSS} from '../lib/web-typography.mjs';
function escHtml(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function updateSettingsHtml({surface='local',csrfToken='',brandHtml='Light Remote',modulesAvailable=false}={}){
  const fleet=surface==='fleet';
  const title=fleet?'Fleet Update':'Device Update';
  const activitySettings=fleet?'':`<section class="card" id="activityLogSettings">
    <h2>Activity Logs · This device</h2>
    <p class="muted">Agent commands and output on this Local Wall are stored only on THIS device. RAM is limited to 8 MiB / 5,000 events / 60 minutes.</p>
    <label for="activityLogPreset">Disk retention · mandatory rotation</label>
    <div class="actions">
      <select id="activityLogPreset" class="btn">
        <option value="compact">Compact · 16 MiB × 3 files (48 MiB max)</option>
        <option value="standard">Standard · 50 MiB × 4 files (200 MiB max, default)</option>
        <option value="extended">Extended · 50 MiB × 6 files (300 MiB max)</option>
      </select>
      <button id="activityLogSave" class="btn" type="button">Save retention</button>
      <button id="activityLogRefresh" class="btn" type="button">Refresh</button>
      <button id="activityLogHistory" class="btn" type="button">Read last 100 events</button>
    </div>
    <p class="muted">No unlimited mode. Writes stop when disk space is low. This device's activity log is not synced to Operator or Long Memory.</p>
    <div id="activityLogStatus" class="muted" role="status" style="white-space:pre-wrap;overflow-wrap:anywhere"></div>
    <pre id="activityLogHistoryResult" hidden style="max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:12px"></pre>
    <div class="actions">
      <input id="activityLogCleanConfirm" autocomplete="off" spellcheck="false" placeholder="Type CLEAN ACTIVITY LOGS" style="min-width:250px;padding:9px;background:#0b1015;color:#e9eef4;border:1px solid #2b333d;border-radius:7px">
      <button id="activityLogClean" class="btn" type="button" style="color:#ff9e9e;border-color:#914c4c">Clean activity logs</button>
    </div>
    <p class="muted">Only local Wall activity logs are removed. Long Memory, Codex, device enrollment and Operator audit logs are untouched.</p>
  </section>`;
  const memorySettings=(fleet||!modulesAvailable)?'':`<section class="card" id="memoryDeleteSettings">
    <h2>Long Memory · Data deletion</h2>
    <p class="muted">Choose the deletion scope. This is irreversible for data not backed up elsewhere. Export anything you need from Long Memory first.</p>
    <label style="display:block;margin:10px 0"><input type="radio" name="memoryDeleteScope" value="local" checked> <b>Delete memory on this device</b></label>
    <p class="muted">Clears local notes, scoped checkpoints and sync queues while preserving Light Remote enrollment and Codex tasks. Disable this device in Memory Sync first to prevent a Replica resync.</p>
    <label style="display:block;margin:10px 0"><input type="radio" name="memoryDeleteScope" value="account" disabled> <b>Delete memory across all account devices</b> · Not yet available</label>
    <p class="muted">Requires durable account tombstones and acknowledgment by offline devices. This build refuses an unverified account-wide deletion.</p>
    <div class="actions">
      <button id="memoryDeletePreview" class="btn" type="button">Inspect local memory</button>
      <input id="memoryDeleteConfirmation" maxlength="32" autocomplete="off" spellcheck="false" placeholder="Type DELETE LOCAL MEMORY" style="min-width:250px;padding:9px;background:#0b1015;color:#e9eef4;border:1px solid #2b333d;border-radius:7px">
      <button id="memoryDeleteLocal" class="btn" type="button" style="color:#ff9e9e;border-color:#914c4c">Delete local memory</button>
    </div>
    <pre id="memoryDeleteResult" role="status" style="white-space:pre-wrap;font-size:12px;overflow-wrap:anywhere"></pre>
    <div class="muted">Local-only deletion does not erase copies previously exported, backed up or held by offline replicas. Account deletion is blocked until its delivery protocol is implemented.</div>
  </section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${brandFaviconSvg()}<title>Light Remote — ${title}</title><style>
${WALL_FONT_FACE_CSS}:root{color-scheme:dark;font-family:${WALL_UI_FONT};background:#080a0c;color:#d8dee7}*{box-sizing:border-box}body{margin:0;background:#080a0c}.wrap{max-width:980px;margin:4vh auto;padding:18px}.brand{display:flex;align-items:center;gap:12px}.brand svg{width:44px;height:44px}.card{margin-top:14px;border:1px solid #252d36;border-radius:10px;background:#0a0e12;padding:16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.row{border:1px solid #202832;border-radius:8px;padding:12px;background:#0b1015}.muted{color:#718096}.ok{color:#78d78b}.hold{color:#e6c36b}.error{color:#ff8e8e}.btn{border:1px solid #2b333d;background:#0e1216;color:#cfd7e3;border-radius:7px;padding:9px 11px;font:inherit;cursor:pointer;text-decoration:none;display:inline-block}.primary{background:#18232e;border-color:#52697f}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.mono{font-family:${WALL_CODE_FONT};word-break:break-word}button:disabled{opacity:.45;cursor:not-allowed}${WALL_TYPOGRAPHY_CSS}</style></head><body><main class="wrap"><div class="brand"><span>${brandHtml}</span><div><b>Light Remote</b><div class="muted">${title}</div></div></div><section class="card"><a class="btn" href="/">${materialIcon('arrowBack')}<span>Wall</span></a><h1>Update</h1><p class="muted">Updater Helper is independent from Core. Core is committed only after health acknowledgement; failed Core updates roll back automatically.</p><div id="content" class="grid"><div class="row muted">Loading update state…</div></div><div class="actions"><button id="refresh" class="btn">Refresh</button>${fleet?'<button id="updateAll" class="btn primary">Update all current clients</button>':'<button id="check" class="btn">Check now</button><button id="update" class="btn primary">Update now</button>'}</div><div id="msg" class="muted" style="margin-top:12px"></div></section>${memorySettings}${activitySettings}</main><script>
const csrf=${JSON.stringify(csrfToken)},fleet=${fleet?'true':'false'},modulesAvailable=${modulesAvailable?'true':'false'},content=document.getElementById('content'),msg=document.getElementById('msg');
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function stateClass(s){return ['success','idle','available'].includes(String(s||''))?'ok':['failed','rollback_failed'].includes(String(s||''))?'error':'hold';}
function card(label,value,detail=''){return '<div class="row"><b>'+esc(label)+'</b><div class="mono '+stateClass(value)+'" style="margin-top:6px">'+esc(value||'unknown')+'</div>'+(detail?'<div class="muted" style="margin-top:6px">'+esc(detail)+'</div>':'')+'</div>';}
async function mutate(path,payload={}){const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-light-remote-csrf':csrf},body:JSON.stringify(payload)}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'update_action_failed');return j;}
async function loadLocal(){const r=await fetch('/api/status',{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'status_failed');const s=j.local||{},u=s.update||{},managed=String(u.mode||'')==='server-managed';content.innerHTML=card('Core',s.version||u.currentVersion||'unknown','Current application runtime')+card('Update state',u.state||'idle',managed?'Managed by the server deployment plane':(u.targetVersion?'Target '+u.targetVersion:'No newer version reported'))+card('Updater Helper',u.helperVersion||'unknown',managed?'Server runtime is deployed atomically; client Helper does not apply here':'Independent recovery/update runtime')+card('Last error',u.code||'none',u.pendingReport?.outcome?u.pendingReport.outcome+' · '+(u.pendingReport.code||''):'');const check=document.getElementById('check'),update=document.getElementById('update');if(check)check.disabled=managed;if(update)update.disabled=managed||String(u.state)!=='available';if(managed){msg.className='muted';msg.textContent='This Wall is part of the Light Remote server host. Update it through the governed server deployment plane.';}}
async function loadFleet(){const r=await fetch('/api/devices',{cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||'devices_failed');const rows=(j.devices||[]).filter(d=>d.deviceId!==j.mainDeviceId);content.innerHTML=rows.length?rows.map(d=>{const u=d.update||{},detail=[d.platform+'/'+d.architecture,'Core '+(d.agentVersion||'unknown'),'Update '+(u.state||'idle')+(u.targetVersion?' → '+u.targetVersion:''),u.code?'Error '+u.code:''].filter(Boolean).join(' · ');return card(d.displayName||d.deviceId,d.state||'unknown',detail);}).join(''):'<div class="row muted">No current leaf clients.</div>';}
async function load(){msg.textContent='';try{await (fleet?loadFleet():loadLocal());}catch(e){msg.className='error';msg.textContent=e.message;}}
document.getElementById('refresh').onclick=load;
if(fleet){document.getElementById('updateAll').onclick=async e=>{e.currentTarget.disabled=true;msg.className='muted';msg.textContent='Queueing updates for current online clients…';try{const j=await mutate('/api/updates/all');msg.className='ok';msg.textContent='Queued '+String(j.queued||0)+' client(s); skipped '+String(j.skipped||0)+'.';await loadFleet();}catch(err){msg.className='error';msg.textContent=err.message;}finally{e.currentTarget.disabled=false;}};}else{
document.getElementById('check').onclick=async e=>{e.currentTarget.disabled=true;msg.className='muted';msg.textContent='Checking signed update channel…';try{await mutate('/api/update/check',{mode:'check'});msg.textContent='Check requested. Refresh shortly for result.';setTimeout(load,1200);}catch(err){msg.className='error';msg.textContent=err.message;}finally{e.currentTarget.disabled=false;}};
document.getElementById('update').onclick=async e=>{e.currentTarget.disabled=true;msg.className='muted';msg.textContent='Update requested. Helper will verify, install, health-check and roll back if needed.';try{await mutate('/api/update/request',{mode:'apply'});setTimeout(load,1200);}catch(err){msg.className='error';msg.textContent=err.message;}finally{e.currentTarget.disabled=false;}};}
if(!fleet){
  const logStatus=document.getElementById('activityLogStatus'),logPreset=document.getElementById('activityLogPreset');
  const mb=n=>(Number(n||0)/1048576).toFixed(1)+' MiB';
  async function refreshActivityLog(){
    try{
      const r=await fetch('/api/activity/logs/state',{cache:'no-store'}),j=await r.json();
      if(!r.ok||!j.ok)throw Error(j.error||'local_activity_log_unavailable');
      const x=j.log;logPreset.value=x.preset;
      logStatus.className=x.lastError?'error':'muted';
      logStatus.textContent='Used '+mb(x.usedBytes)+' / '+mb(x.maxDiskBytes)+
        ' · '+x.files.length+' file(s) · RAM '+x.ramEvents+' events ('+mb(x.ramBytes)+')'+
        (x.lastError?' · Write warning: '+x.lastError:'')+
        String.fromCharCode(10)+'Stored on this device: '+x.directory;
    }catch(e){logStatus.className='error';logStatus.textContent=String(e.message||e);}
  }
  document.getElementById('activityLogRefresh').onclick=refreshActivityLog;
  document.getElementById('activityLogHistory').onclick=async e=>{
    const button=e.currentTarget,preview=document.getElementById('activityLogHistoryResult');
    button.disabled=true;preview.hidden=false;preview.textContent='Reading local activity...';
    try{
      const r=await fetch('/api/activity/logs/history?limit=100',{cache:'no-store'}),j=await r.json();
      if(!r.ok||!j.ok)throw Error(j.error||'activity_log_history_unavailable');
      const events=j.events||[];
      preview.textContent=events.length?events.map(ev=>{
        const date=String(ev.at||''),kind=String(ev.type||''),status=String(ev.status||'');
        const details=String(ev.script||ev.chunk||ev.resultSummary||'').slice(0,3000);
        return date+' | '+kind+' '+status+(details?String.fromCharCode(10)+details:'');
      }).join(String.fromCharCode(10,10)):'No local activity has been stored yet.';
    }catch(err){preview.textContent=String(err.message||err);}
    finally{button.disabled=false;}
  };

  document.getElementById('activityLogSave').onclick=async e=>{
    const button=e.currentTarget;button.disabled=true;
    try{await mutate('/api/activity/logs/config',{preset:logPreset.value});await refreshActivityLog();}
    catch(err){logStatus.className='error';logStatus.textContent=String(err.message||err);}
    finally{button.disabled=false;}
  };
  document.getElementById('activityLogClean').onclick=async e=>{
    const field=document.getElementById('activityLogCleanConfirm');
    if(field.value.trim()!=='CLEAN ACTIVITY LOGS'){
      logStatus.className='error';logStatus.textContent='Type CLEAN ACTIVITY LOGS exactly.';return;
    }
    if(!await wallConfirm('Clear ONLY this device’s activity logs? This cannot be undone. Long Memory, Codex and Operator audit logs are not affected.'))return;
    const button=e.currentTarget;button.disabled=true;
    try{await mutate('/api/activity/logs/clean',{confirmText:field.value.trim()});
      field.value='';await refreshActivityLog();
      logStatus.textContent+=String.fromCharCode(10)+'Local activity logs cleaned. New activity will still be recorded.';
    }catch(err){logStatus.className='error';logStatus.textContent=String(err.message||err);}
    finally{button.disabled=false;}
  };
  void refreshActivityLog();
}
if(!fleet&&modulesAvailable){
  const summary=document.getElementById('memoryDeleteResult');
  const preview=document.getElementById('memoryDeletePreview');
  const del=document.getElementById('memoryDeleteLocal');
  preview.onclick=async()=>{
    preview.disabled=true;summary.className='muted';summary.textContent='Checking local memory…';
    try{
      const r=await fetch('/api/gold/modules/memory/delete/preview',{cache:'no-store'}),j=await r.json();
      if(!r.ok||!j.ok)throw Error(j.error||'memory_preview_unavailable');
      const p=j.preview;
      summary.textContent='Local memory records: '+p.totalRows+' · this device only.\\n'+
        'Existing backups/exports and other devices are not included.';
    }catch(e){summary.className='error';summary.textContent=String(e.message||e);}
    finally{preview.disabled=false;}
  };
  del.onclick=async()=>{
    const typed=document.getElementById('memoryDeleteConfirmation').value.trim();
    if(typed!=='DELETE LOCAL MEMORY'){
      summary.className='error';summary.textContent='Type DELETE LOCAL MEMORY exactly before continuing.';
      return;
    }
    if(!await wallConfirm('Permanently delete this device’s local Long Memory? This cannot be undone. Other devices and backups are NOT deleted.')){
      return;
    }
    del.disabled=true;summary.className='hold';summary.textContent='Deleting local memory…';
    try{
      const j=await mutate('/api/gold/modules/memory/delete/local',{confirmText:typed});
      summary.className='ok';
      summary.textContent='Local memory cleared · '+j.result.totalRows+
        ' rows removed. This device will not accept memory sync until re-enabled by the owner.';
      document.getElementById('memoryDeleteConfirmation').value='';
    }catch(e){
      summary.className='error';summary.textContent=String(e.message||e)+
        '\\nIf sync is enabled for this device, first deselect it in Long Memory → Memory Sync.';
    }finally{del.disabled=false;}
  };
}
load();setInterval(()=>{if(!document.hidden)load();},10000);
</script></body></html>`.replace("</body>",WALL_DIALOG_EMBED+"</body>");
}

export {escHtml};
