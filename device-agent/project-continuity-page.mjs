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
</style></head><body><header><b>Light Remote <span class="muted">/ Project Continuity</span></b><nav><a href="/">Wall</a> &nbsp; · &nbsp; <a href="/permissions">Permissions</a></nav></header>
<main><h1>Projects</h1><div class="muted">Local project state · Owner-controlled · Experimental P1</div><p id="notice" role="status"></p>
<div class="layout"><section class="panel"><h2>Local projects</h2><div id="list"></div><hr>
<form id="create"><label>New project name</label><input id="projectName" maxlength="160" required placeholder="e.g. Light Remote Gold">
<label>Workspace (metadata only)</label><input id="workspace" maxlength="4096" placeholder="Absolute project directory">
<button type="submit" class="primary" style="margin-top:12px">Create project</button></form></section>
<section class="panel"><div id="empty" class="muted">Choose a project on the left to manage optional modules.</div>
<div id="detail" hidden><h2 id="title"></h2><div class="muted" id="meta"></div>
<hr><h2>Optional modules</h2>
<div class="switch"><span><b>Project Memory</b><br><small>Persistent local facts and checkpoint retrieval</small></span><input aria-label="Enable Project Memory" id="memory" type="checkbox"></div>
<div class="switch"><span><b>Codex Bridge</b><br><small>Codex connection is not activated by this switch in P1</small></span><input aria-label="Enable Codex Bridge" id="codex" type="checkbox"></div>
<p class="muted" style="font-size:12px">Each module is independent. Enabling Codex here only records its preference; no Codex login or worker starts in P1.</p>
<button class="primary" id="save">Save modules</button><hr>
<h2>Task Controller</h2><form id="taskCreate" class="row"><input id="taskTitle" placeholder="New task" maxlength="160" required><button type="submit">Add task</button></form>
<div id="tasks"></div>
<form id="sectionCreate" style="margin-top:12px">
<label>Task</label><select id="sectionTask" required style="width:100%;background:#0a1321;border:1px solid #304158;color:#edf5ff;padding:10px;border-radius:7px"></select>
<label>Section name</label><input id="sectionTitle" maxlength="160" required placeholder="e.g. Install and verify">
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
const CSRF=__CSRF_JSON__;let items=[],active=null;
const by=id=>document.getElementById(id),notice=(msg,error=false)=>{by('notice').textContent=msg;by('notice').className=error?'error':'ok';};
async function api(action,data){
 const post=!!data;
 const res=await fetch('/api/project-continuity/'+action,{method:post?'POST':'GET',headers:{'content-type':'application/json','x-light-remote-csrf':CSRF},body:post?JSON.stringify(data):undefined,cache:'no-store'});
 const body=await res.json();if(!res.ok||!body.ok)throw Error(body.error||'Request failed');return body.result;
}
async function all(){try{items=await api('listProjects');renderList();if(active)await select(active);}catch(e){notice(e.message,true);}}
function renderList(){
 const list=by('list');list.replaceChildren();
 if(!items.length){list.textContent='No projects created';list.className='muted';return;}
 for(const p of items){const e=document.createElement('div');e.className='item';e.tabIndex=0;e.setAttribute('role','button');e.setAttribute('aria-current',String(active===p.id));e.textContent=p.name;e.onclick=()=>select(p.id);e.onkeydown=ev=>{if(ev.key==='Enter')select(p.id);};list.append(e);}
}
async function select(id){
 try{active=id;const p=items.find(x=>x.id===id);if(!p){active=null;return;}
 by('empty').hidden=true;by('detail').hidden=false;by('title').textContent=p.name;by('meta').textContent=p.workspace||'No workspace selected';
 by('memory').checked=!!p.memory_enabled;by('codex').checked=!!p.codex_enabled;
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
   for(const section of t.sections){const p=document.createElement('div');p.className='muted';p.textContent=section.title+' · '+section.state+(section.reason?' ('+section.reason+')':'');row.append(p);}
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
by('create').onsubmit=async e=>{e.preventDefault();try{const p=await api('createProject',{name:by('projectName').value,workspace:by('workspace').value});by('projectName').value='';items=await api('listProjects');await select(p.id);notice('Local project created');}catch(err){notice(err.message,true);}};
by('save').onclick=async()=>{const p=items.find(x=>x.id===active);if(!p)return;try{const updated=await api('setModules',{projectId:p.id,memory:by('memory').checked,codex:by('codex').checked,expectedRevision:p.revision});items=items.map(x=>x.id===updated.id?updated:x);await select(updated.id);notice('Module settings saved locally');}catch(e){notice(e.message,true);}};
by('taskCreate').onsubmit=async e=>{e.preventDefault();try{await api('createTask',{projectId:active,title:by('taskTitle').value});by('taskTitle').value='';await refresh();notice('Task added');}catch(err){notice(err.message,true);}};
by('sectionCreate').onsubmit=async e=>{e.preventDefault();try{await api('addSection',{taskId:by('sectionTask').value,title:by('sectionTitle').value});by('sectionTitle').value='';await refresh();notice('Section added');}catch(err){notice(err.message,true);}};
by('memoryCreate').onsubmit=async e=>{e.preventDefault();try{await api('memoryPut',{projectId:active,body:by('memoryBody').value,sourceRef:by('memorySource').value,kind:by('memoryKind').value});by('memoryBody').value='';await refresh();notice('Local memory recorded (unverified)');}catch(err){notice(err.message,true);}};
by('memorySearchForm').onsubmit=async e=>{e.preventDefault();try{const q=by('memoryQuery').value.trim();if(!q)return;const rows=await api('memorySearch',{projectId:active,query:q,limit:10});by('memoryResults').textContent=JSON.stringify(rows,null,2);notice('Memory matches: '+rows.length);}catch(err){notice(err.message,true);}};
by('makeHandoff').onclick=async()=>{try{const data=await api('contextBrief',{projectId:active,maxChars:10000});by('handoff').textContent=data.content;notice('Bounded handoff generated from SQLite');}catch(err){notice(err.message,true);}};
by('refresh').onclick=refresh;all();
</script></body></html>`;
return page.replace('__CSRF_JSON__',JSON.stringify(csrf));
}
