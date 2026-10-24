/* P1 optional owner-authenticated Local Wall Projects view. */
export function continuityProjectsPage(csrf){
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Light Remote — Projects</title>
<style>
:root{color-scheme:dark;font-family:system-ui,"Segoe UI",sans-serif;color:#dce5f2;background:#080d17}
*{box-sizing:border-box}body{margin:0;min-height:100vh}header{height:58px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #273347;padding:0 26px;background:#0b1220}
header b{font-size:15px;letter-spacing:.3px}a{color:#80c5ff;text-decoration:none}a:hover{text-decoration:underline}
small,.muted{color:#8ca0b8}main{max-width:1260px;margin:auto;padding:28px}h1{font-size:24px;margin:0 0 5px}h2{font-size:15px;margin:0 0 14px}
.layout{display:grid;grid-template-columns:310px 1fr;gap:18px;margin-top:22px}.panel{border:1px solid #263449;border-radius:10px;background:#101929;padding:18px;min-width:0}
input,button{font:inherit;border-radius:7px;padding:10px;color:#edf5ff}input{border:1px solid #304158;background:#0a1321;width:100%}input:focus{outline:1px solid #2e9fff}
button{border:1px solid #375674;background:#163456;cursor:pointer}button.primary{background:#0758a7;border-color:#3485db}button:disabled{opacity:.45;cursor:not-allowed}
label{display:block;margin:12px 0 6px;font-size:12px;color:#aabbd0}.row{display:flex;gap:10px;align-items:center}.row>*{min-width:0}
.item{padding:12px;border:1px solid #283b51;background:#101e30;border-radius:7px;margin:8px 0;cursor:pointer;overflow-wrap:anywhere}
.item[aria-current=true]{border-color:#328bd8;background:#173356}.tag{font-size:11px;padding:2px 7px;border:1px solid #3b5b7b;border-radius:12px;color:#91d2ff}
.switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #273449}.switch input{width:19px;height:19px;accent-color:#2b92ec}
hr{border:0;border-top:1px solid #243247;margin:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,Consolas,monospace;color:#b0c7e2;background:#0b1320;border:1px solid #26374b;padding:12px;border-radius:8px;max-height:340px;overflow:auto}
#notice{min-height:22px;font-size:12px;color:#9bb9d7}.error{color:#ff9b9b!important}.ok{color:#78e2c5!important}.card{border:1px solid #28384b;border-radius:7px;padding:12px;margin-top:10px}
@media(max-width:800px){main{padding:14px}.layout{grid-template-columns:1fr}header{padding:0 14px}}
</style></head><body><header><b>Light Remote <span class="muted">/ Continuity</span></b><nav><a href="/">Wall</a> &nbsp; · &nbsp; <a href="/permissions">Permissions</a></nav></header>
<main><h1>Long Memory &amp; Codex Observer</h1><div class="muted">Two optional modules within your existing Light Remote Gold Wall · data on local client</div><p id="notice" role="status"></p>
<section class="panel" id="continuityModules" aria-label="Light Remote optional modules">
<h2>Light Remote — Optional modules</h2>
<p class="muted">These are independent Light Remote device settings. <b>No Project needs to be created first.</b> Projects below only organize tasks, decisions and memory scopes.</p>
<div class="switch"><span><b>Long Memory</b><br><small>Recover context across ChatGPT Web sessions when authorized. No Codex subscription or Project needed.</small></span><input aria-label="Enable Project Memory globally" id="memory" type="checkbox"></div>
<div class="switch"><span><b>Codex Bridge — Observer</b><br><small>Read-only planning observer. It may recommend when ChatGPT should continue, but it cannot code, execute tasks or control ChatGPT Web without a supported integration.</small></span><input aria-label="Enable Codex Bridge globally" id="codex" type="checkbox"></div>
<div class="row" style="margin-top:12px"><button class="primary" id="save">Save Light Remote modules</button><span id="moduleState" class="muted">Loading module settings…</span></div>
<div id="globalMemoryArea" hidden>
 <hr><h2>ChatGPT Web cross-session access</h2>
 <p class="muted">Long Memory stays on this device. Enable reading from the same account-bound Gold plugin only when needed. Uses your existing Gold Wall/account login and a separate owner confirmation. No Project creation is required.</p>
 <div id="globalRemoteStatus" class="muted">Remote recall: OFF</div>
 <form id="globalConsentForm">
  <label>Allow ChatGPT Web to retrieve this device's default Memory</label>
  <select id="globalConsentAction" style="width:100%;background:#0a1321;border:1px solid #304158;color:#edf5ff;padding:10px;border-radius:7px"><option value="off">Do not share</option><option value="on">Allow owner-approved recall</option></select>
  <label>Confirm your existing Gold Wall/account password</label>
  <input id="globalOwnerPassword" type="password" autocomplete="current-password" required>
  <button type="submit">Confirm remote recall permission</button>
 </form>
 <hr><h3>Allow ChatGPT to propose local checkpoint notes</h3>
 <p class="muted">Separate permission from read access. Agent notes saved locally remain unverified; no automatic chat transcript capture.</p>
 <div id="globalRemoteWriteStatus" class="muted">Checkpoint submissions: OFF</div>
 <form id="globalWriteConsentForm">
  <label>Agent checkpoint submissions</label>
  <select id="globalWriteConsentAction"><option value="off">Do not permit</option><option value="on">Permit via authorized Gold session</option></select>
  <label>Existing Gold Wall/account password</label>
  <input id="globalWriteOwnerPassword" type="password" autocomplete="current-password" required>
  <button type="submit">Apply checkpoint permission</button>
 </form>
 <hr><h2>Default Memory — No Project required</h2>
 <p class="muted">Use this local context before organizing any Project. Notes are evidence, not executable instructions.</p>
 <form id="globalMemoryForm">
  <label>Remember (local only)</label><input id="globalMemoryBody" maxlength="12000" required placeholder="Important decision, fact or handoff context">
  <label>Source reference</label><input id="globalMemorySource" maxlength="2048" required placeholder="Owner note or source document">
  <button type="submit">Save to default Memory</button>
 </form>
 <form id="globalMemorySearchForm" class="row" style="margin-top:12px">
  <input id="globalMemoryQuery" maxlength="300" placeholder="Search default Memory">
  <button type="submit">Search</button>
 </form>
 <pre id="globalMemoryResults" aria-label="Default Memory results"></pre>
 <h3>Recent Light Remote activity</h3>
 <p class="muted">Locally saved tool-result metadata only. No chat transcript, command arguments or output. Decisions still need confirmed evidence.</p>
 <button id="reloadActivity" type="button">Refresh local activity</button>
 <pre id="globalToolActivity" aria-label="Observed local Gold tool activity"></pre>
</div>
<div id="globalCodexArea" hidden>
 <hr><h2>Codex Bridge — Plan observer</h2>
 <p class="muted">Codex may observe the task ledger and suggest a safe continuation. Codex does NOT perform tasks or inject ChatGPT Web messages in this build. No Project is required.</p>
 <form id="defaultPlanCreate" class="row">
  <input id="defaultPlanTitle" maxlength="160" placeholder="Current work plan or task">
  <button type="submit">Record plan/task</button>
 </form>
 <pre id="defaultPlanState" aria-label="Local default task state"></pre>
</div>
</section>
<div class="layout"><section class="panel"><h2>Local projects (optional organization)</h2><div id="list"></div><hr>
<form id="create"><label>New project name</label><input id="projectName" maxlength="160" required placeholder="e.g. Light Remote Gold">
<label>Workspace (metadata only)</label><input id="workspace" maxlength="4096" placeholder="Absolute project directory">
<button type="submit" class="primary" style="margin-top:12px">Create project</button></form></section>
<section class="panel"><div id="empty" class="muted">Choose a project to manage its tasks and scoped memory. The Light Remote module switches are above.</div>
<div id="detail" hidden><h2 id="title"></h2><div class="muted" id="meta"></div>
<hr><h2>Remote Memory Access</h2>
<p class="muted" style="font-size:12px">Disabled by default. Grants an explicitly chosen Project to a linked ChatGPT session. Re-enter your Local Wall or account password to change this setting.</p>
<div id="remoteStatus" class="muted">Remote sharing: OFF</div>
<form id="remoteConsentForm"><label>Owner action</label><select id="remoteConsentAction" style="width:100%;background:#0a1321;border:1px solid #304158;color:#edf5ff;padding:10px;border-radius:7px"><option value="off">Revoke remote read</option><option value="on">Allow remote read</option></select>
<label>Re-enter owner password</label><input id="remoteOwnerPassword" type="password" autocomplete="current-password" required placeholder="Owner credentials are not saved">
<button class="primary" type="submit" style="margin-top:10px">Verify owner and apply</button></form>
<h2 style="margin-top:24px">Refresh signing-key protection after password change</h2>
<p class="muted" style="font-size:12px">First change your actual Light Remote account or Local Wall login password outside this page. Then enter the previous and current passwords here to re-encrypt the same signing key. This does not change your account password or revoke existing consent.</p>
<form id="ownerRekeyForm"><label>Previous owner password</label>
<input id="ownerOldPassword" type="password" autocomplete="off" required>
<label>Current owner login password</label>
<input id="ownerNewPassword" type="password" autocomplete="current-password" minlength="12" required>
<button type="submit" style="margin-top:10px">Re-encrypt signing key</button></form><hr>
<h2>Task Controller</h2><form id="taskCreate" class="row"><input id="taskTitle" placeholder="New task" maxlength="160" required><button type="submit">Add task</button></form>
<div id="tasks"></div>
<form id="sectionCreate" style="margin-top:12px">
<label>Task</label><select id="sectionTask" required style="width:100%;background:#0a1321;border:1px solid #304158;color:#edf5ff;padding:10px;border-radius:7px"></select>
<label>Section name</label><input id="sectionTitle" maxlength="160" required placeholder="e.g. Install and verify">
<label>Shared resource key (optional; coordination only)</label><input id="sectionResource" maxlength="192" placeholder="e.g. workspace:/repos/gold">
<label>Resource intent</label><select id="sectionMode" style="width:100%;background:#0a1321;border:1px solid #304158;color:#edf5ff;padding:10px;border-radius:7px"><option value="write">Write (exclusive)</option><option value="read">Read (shared)</option></select>
<p class="muted" style="font-size:12px">Resource locks coordinate sections across Projects. They do not grant filesystem access.</p>
<button type="submit" style="margin-top:8px">Add section (independent)</button>
</form><hr><h2>Project Memory</h2>
<p class="muted" style="font-size:12px">Owner-curated local notes; unverified until owner confirmation. No automatic chat scraping.</p>
<form id="memoryCreate"><label>Memory / decision / observation</label><input id="memoryBody" maxlength="12000" required placeholder="What should be remembered?">
<label>Source reference</label><input id="memorySource" maxlength="2048" required placeholder="docs/handoff.md or commit SHA">
<label>Kind</label><select id="memoryKind" style="width:100%;background:#0a1321;border:1px solid #304158;color:#edf5ff;padding:10px;border-radius:7px"><option value="observation">Observation</option><option value="fact">Fact (unverified)</option><option value="decision">Decision (unverified)</option><option value="hypothesis">Hypothesis</option></select>
<button type="submit" style="margin-top:8px">Save local memory</button></form>
<form id="memorySearchForm" class="row" style="margin-top:12px"><input id="memoryQuery" placeholder="Search project memory" maxlength="300"><button type="submit">Search</button></form>
<pre id="memoryResults"></pre><button id="makeHandoff">Generate bounded handoff</button>
<pre id="handoff"></pre><hr><h2>Durable checkpoint</h2><p class="muted" style="font-size:12px">Read-only view generated from canonical SQLite state, not inferred by AI.</p>
<button id="refresh">Refresh checkpoint</button><pre id="checkpoint" aria-label="Project checkpoint"></pre></div></section></div></main>
<script>
const CSRF=__CSRF_JSON__;let items=[],active=null,moduleState=null;
const by=id=>document.getElementById(id),notice=(msg,error=false)=>{by('notice').textContent=msg;by('notice').className=error?'error':'ok';};
async function api(action,data){
 const post=!!data;
 const res=await fetch('/api/project-continuity/'+action,{method:post?'POST':'GET',headers:{'content-type':'application/json','x-light-remote-csrf':CSRF},body:post?JSON.stringify(data):undefined,cache:'no-store'});
 const body=await res.json();if(!res.ok||!body.ok)throw Error(body.error||'Request failed');return body.result;
}
async function all(){try{
 moduleState=await api('getGlobalModules');
 by('memory').checked=!!moduleState.memoryEnabled;
 by('codex').checked=!!moduleState.codexEnabled;
 by('moduleState').textContent='Device-wide · revision '+moduleState.revision;
 by('globalMemoryArea').hidden=!moduleState.memoryEnabled;
 by('globalCodexArea').hidden=!moduleState.codexEnabled;
 if(moduleState.codexEnabled){
  const snap=await api('checkpoint',{projectId:moduleState.defaultScopeId});
  by('defaultPlanState').textContent=JSON.stringify({
    tasks:snap.tasks,pendingApprovals:snap.pendingApprovals,sequence:snap.sequence
  },null,2);
 }
 if(moduleState.memoryEnabled){
  const scope=await api('getProject',{projectId:moduleState.defaultScopeId});
  by('globalRemoteStatus').textContent='ChatGPT remote recall: '+(scope?.remote_read_enabled?'ON':'OFF');
  by('globalConsentAction').value=scope?.remote_read_enabled?'on':'off';
  const writeScope=await api('remoteWriteStatus',{projectId:moduleState.defaultScopeId});
  by('globalRemoteWriteStatus').textContent='ChatGPT checkpoint submissions: '+(writeScope?.enabled?'ON':'OFF');
  by('globalWriteConsentAction').value=writeScope?.enabled?'on':'off';
 }
 if(moduleState.memoryEnabled){
  const timeline=await api('recentGoldActivity',{limit:12});
  by('globalToolActivity').textContent=timeline.length?JSON.stringify(timeline,null,2):'No Gold tool receipts recorded yet';
 }
 items=await api('listProjects');renderList();if(active)await select(active);
}catch(e){notice(e.message,true);}}
function renderList(){
 const list=by('list');list.replaceChildren();
 if(!items.length){list.textContent='No projects created';list.className='muted';return;}
 for(const p of items){const e=document.createElement('div');e.className='item';e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-current',String(active===p.id));e.textContent=p.name;e.onclick=()=>select(p.id);e.onkeydown=ev=>{if(ev.key==='Enter')select(p.id);};list.append(e);}
}
async function select(id){
 try{active=id;const p=items.find(x=>x.id===id);if(!p){active=null;return;}
 by('empty').hidden=true;by('detail').hidden=false;by('title').textContent=p.name;by('meta').textContent=p.workspace||'No workspace selected';
 // Device-wide module controls are never overwritten when selecting a Project.
 by('remoteStatus').textContent='Remote sharing: '+(p.remote_read_enabled?'ON':'OFF');
 by('remoteConsentAction').value=p.remote_read_enabled?'on':'off';
 by('remoteConsentForm').hidden=!(moduleState?.memoryEnabled && p.memory_enabled);
 renderList();await refresh();
 }catch(e){notice(e.message,true);}
}
async function refresh(){
 if(!active)return;try{
  const snapshot=await api('checkpoint',{projectId:active});
  by('checkpoint').textContent=JSON.stringify(snapshot,null,2);
  const box=by('tasks');box.replaceChildren();
  for(const t of snapshot.tasks){
   const row=document.createElement('div');row.className='card';
   const strong=document.createElement('b');strong.textContent=t.title;row.append(strong);
   for(const section of t.sections){const p=document.createElement('div');p.className='muted';p.textContent=section.title+' · '+section.state+(section.reason?' ('+section.reason+')':'')+(section.resources?.length?' · '+section.resources.map(r=>r.mode+':'+r.key).join(', '):'');row.append(p);}
   box.append(row);
  }
  if(!snapshot.tasks.length)box.textContent='No tasks yet';
  const select=by('sectionTask');select.replaceChildren();
  for(const task of snapshot.tasks){const opt=document.createElement('option');opt.value=task.id;opt.textContent=task.title;select.append(opt);}
  by('sectionCreate').hidden=snapshot.tasks.length===0;
  const mem=!!snapshot.project.memoryEnabled;
  by('memoryCreate').hidden=!mem;by('memorySearchForm').hidden=!mem;by('makeHandoff').hidden=!mem;
  if(mem){
   const rows=await api('memoryRecent',{projectId:active});
   by('memoryResults').textContent=JSON.stringify(rows.slice(0,10),null,2);
  }else{by('memoryResults').textContent='Memory disabled';by('handoff').textContent='';}

 }catch(e){notice(e.message,true);}
}
by('reloadActivity').onclick=()=>all();
by('defaultPlanCreate').onsubmit=async e=>{e.preventDefault();try{
 if(!moduleState?.codexEnabled)throw Error('Codex Bridge is disabled');
 const title=by('defaultPlanTitle').value.trim();
 if(!title)return;
 await api('createTask',{projectId:moduleState.defaultScopeId,title});
 by('defaultPlanTitle').value='';
 await all();notice('Recorded local Controller task, no Project required');
}catch(error){notice(error.message,true);}};
by('globalWriteConsentForm').onsubmit=async e=>{e.preventDefault();
 const password=by('globalWriteOwnerPassword').value;by('globalWriteOwnerPassword').value='';
 try{
  if(!moduleState?.memoryEnabled)throw Error('Enable Long Memory first');
  const scope=await api('getProject',{projectId:moduleState.defaultScopeId});
  if(!scope)throw Error('Local Memory scope not initialized');
  await api('setRemoteWriteConsent',{projectId:moduleState.defaultScopeId,
   enabled:by('globalWriteConsentAction').value==='on',expectedRevision:scope.revision,password});
  await all();notice('Gold session checkpoint permission updated');
 }catch(error){notice(error.message,true);}
};
by('globalConsentForm').onsubmit=async e=>{e.preventDefault();
 const password=by('globalOwnerPassword').value;
 by('globalOwnerPassword').value='';
 try{
  if(!moduleState?.memoryEnabled)throw Error('Enable Long Memory first');
  const scope=await api('getProject',{projectId:moduleState.defaultScopeId});
  if(!scope)throw Error('Local Memory scope not initialized');
  await api('setRemoteReadConsent',{projectId:moduleState.defaultScopeId,
    enabled:by('globalConsentAction').value==='on',expectedRevision:scope.revision,password});
  await all();
  notice('Default Long Memory read permission updated on this Gold Wall');
 }catch(error){notice(error.message,true);}
};
by('globalMemoryForm').onsubmit=async e=>{e.preventDefault();try{
 if(!moduleState?.memoryEnabled)throw Error('Project Memory is disabled');
 await api('memoryPut',{projectId:moduleState.defaultScopeId,body:by('globalMemoryBody').value,
  sourceRef:by('globalMemorySource').value,kind:'observation'});
 by('globalMemoryBody').value='';notice('Saved default Memory without creating a Project');
}catch(err){notice(err.message,true);}};
by('globalMemorySearchForm').onsubmit=async e=>{e.preventDefault();try{
 if(!moduleState?.memoryEnabled)throw Error('Project Memory is disabled');
 const q=by('globalMemoryQuery').value.trim();if(!q)return;
 const rows=await api('memorySearch',{projectId:moduleState.defaultScopeId,query:q,limit:10});
 by('globalMemoryResults').textContent=JSON.stringify(rows,null,2);
 notice('Default Memory matches: '+rows.length);
}catch(err){notice(err.message,true);}};
by('create').onsubmit=async e=>{e.preventDefault();try{const p=await api('createProject',{name:by('projectName').value,workspace:by('workspace').value});by('projectName').value='';items=await api('listProjects');await select(p.id);notice('Local project created');}catch(err){notice(err.message,true);}};
by('save').onclick=async()=>{try{
 if(!moduleState)throw Error('Module state unavailable');
 const updated=await api('setGlobalModules',{
  memory:by('memory').checked,codex:by('codex').checked,
  expectedRevision:moduleState.revision
 });
 moduleState=updated;await all();
 notice('Light Remote module settings saved · Projects are optional');
}catch(e){notice(e.message,true);}};
by('remoteConsentForm').onsubmit=async e=>{e.preventDefault();const p=items.find(x=>x.id===active);if(!p)return;
 const secret=by('remoteOwnerPassword').value;by('remoteOwnerPassword').value='';
 try{
  const result=await api('setRemoteReadConsent',{projectId:active,enabled:by('remoteConsentAction').value==='on',expectedRevision:p.revision,password:secret});
  items=await api('listProjects');await select(active);notice('Remote Memory consent updated after owner verification');
 }catch(err){notice(err.message,true);}
};
by('ownerRekeyForm').onsubmit=async e=>{e.preventDefault();
 const oldPassword=by('ownerOldPassword').value,newPassword=by('ownerNewPassword').value;
 by('ownerOldPassword').value='';by('ownerNewPassword').value='';
 try{
  const result=await api('rekeyOwnerSigner',{oldPassword,newPassword});
  if(!result.rewrapped||!result.publicKeyUnchanged)throw Error('Signing key rekey unconfirmed');
  notice('Owner signing key re-encrypted; public identity unchanged');
 }catch(err){notice(err.message,true);}
};
by('taskCreate').onsubmit=async e=>{e.preventDefault();try{await api('createTask',{projectId:active,title:by('taskTitle').value});by('taskTitle').value='';await refresh();notice('Task added');}catch(err){notice(err.message,true);}};
by('sectionCreate').onsubmit=async e=>{e.preventDefault();try{await api('addSection',{taskId:by('sectionTask').value,title:by('sectionTitle').value,resources:by('sectionResource').value.trim()?[{key:by('sectionResource').value.trim(),mode:by('sectionMode').value}]:[]});by('sectionTitle').value='';by('sectionResource').value='';await refresh();notice('Section added');}catch(err){notice(err.message,true);}};
by('memoryCreate').onsubmit=async e=>{e.preventDefault();try{await api('memoryPut',{projectId:active,body:by('memoryBody').value,sourceRef:by('memorySource').value,kind:by('memoryKind').value});by('memoryBody').value='';await refresh();notice('Local memory recorded (unverified)');}catch(err){notice(err.message,true);}};
by('memorySearchForm').onsubmit=async e=>{e.preventDefault();try{const q=by('memoryQuery').value.trim();if(!q)return;const rows=await api('memorySearch',{projectId:active,query:q,limit:10});by('memoryResults').textContent=JSON.stringify(rows,null,2);notice('Memory matches: '+rows.length);}catch(err){notice(err.message,true);}};
by('makeHandoff').onclick=async()=>{try{const data=await api('contextBrief',{projectId:active,maxChars:10000});by('handoff').textContent=data.content;notice('Bounded handoff generated from SQLite');}catch(err){notice(err.message,true);}};
by('refresh').onclick=refresh;all();
</script></body></html>`;
return page.replace('__CSRF_JSON__',JSON.stringify(csrf));
}
