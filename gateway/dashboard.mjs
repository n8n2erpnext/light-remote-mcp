export function dashboardHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPS Operator Wall</title><meta name="robots" content="noindex,nofollow,noarchive">
<style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#080a0c;color:#d8dee7}
*{box-sizing:border-box}body{margin:0;background:#080a0c}.wrap{max-width:1480px;margin:auto;padding:18px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}h1{font-size:19px;margin:0}.muted{color:#728095}
.pill,.btn,input,select{border:1px solid #2b333d;background:#0e1216;color:#cfd7e3;border-radius:7px;padding:7px 9px;font:inherit}.controls{display:flex;gap:8px;flex-wrap:wrap}.btn{cursor:pointer}.btn:hover{background:#151b21}
.ok{color:#78d78b}.error{color:#ff8e8e}.timeout{color:#ffb56b}.running{color:#e6c36b}.term{border:1px solid #252d36;border-radius:10px;background:#050708;overflow:hidden}
.head{padding:9px 12px;border-bottom:1px solid #20262d;display:flex;justify-content:space-between;gap:10px}#jobs{max-height:82vh;overflow:auto;padding:8px}
.job{border:1px solid #171d23;border-radius:8px;margin:7px 0;background:#090c0f}.job.hidden{display:none}.jh{display:grid;grid-template-columns:90px 90px 1fr auto;gap:10px;padding:9px 10px;align-items:center;border-bottom:1px solid #151a20}
.meta{padding:8px 10px;color:#8390a1;font-size:12px;white-space:pre-wrap}pre{margin:0;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;max-height:48vh;overflow:auto}.stderr{color:#ffb0b0}.cmd{color:#d9c580}.actions{display:flex;gap:6px}.small{font-size:11px;padding:5px 7px}
@media(max-width:800px){.wrap{padding:10px}.jh{grid-template-columns:72px 1fr}.jh>span:nth-child(2){display:none}.actions{grid-column:1/-1}.meta{font-size:11px}}
</style></head><body><div class="wrap">
<div class="top"><div><h1>wall.dashboard.thaiduy.store</h1><div class="muted">read-only terminal mirror · authoritative full history stays on VPS disk</div></div><span id="conn" class="pill">connecting…</span></div>
<div class="controls"><input id="filter" placeholder="filter session / cwd / command"><select id="status"><option value="">all status</option><option>running</option><option>ok</option><option>error</option><option>timeout</option></select><button id="pause" class="btn">Pause</button><button id="copyVisible" class="btn">Copy visible</button></div>
<div class="term" style="margin-top:10px"><div class="head"><span>LIVE OPERATOR WALL</span><span id="stats" class="muted">0 jobs</span></div><div id="jobs"></div></div>
<script>
const box=document.getElementById('jobs'),filter=document.getElementById('filter'),statusSel=document.getElementById('status'),conn=document.getElementById('conn'),stats=document.getElementById('stats');
const jobs=new Map();let paused=false;let pending=[];
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function jobText(j){return ['['+(j.status||'running')+'] '+(j.jobId||''),'session: '+(j.sessionId||''),'request: '+(j.requestId||''),'cwd: '+(j.cwd||''),'command:\n'+(j.script||''),j.stdout?'stdout:\n'+j.stdout:'',j.stderr?'stderr:\n'+j.stderr:'',j.exitCode!=null?'exit: '+j.exitCode:'',j.durationMs!=null?'duration_ms: '+j.durationMs:''].filter(Boolean).join('\n');}
function applyFilter(){const q=filter.value.toLowerCase(),st=statusSel.value;for(const [id,j] of jobs){const el=document.getElementById('j-'+id);if(!el)continue;const hay=[j.sessionId,j.cwd,j.script,j.note,id].join(' ').toLowerCase();el.classList.toggle('hidden',!!((q&&!hay.includes(q))||(st&&j.status!==st)));}stats.textContent=jobs.size+' jobs';}
function render(j){let el=document.getElementById('j-'+j.jobId);if(!el){el=document.createElement('div');el.className='job';el.id='j-'+j.jobId;box.prepend(el);while(box.children.length>2500)box.lastChild.remove();}
el.innerHTML='<div class="jh"><span class="'+esc(j.status||'running')+'">'+esc(j.status||'running')+'</span><span class="muted">'+esc(new Date(j.at||j.startedAt||Date.now()).toLocaleTimeString())+'</span><span>'+esc((j.script||'').split('\n')[0]||j.jobId)+'</span><span class="actions"><button class="btn small" data-copy="cmd">Copy cmd</button><button class="btn small" data-copy="out">Copy output</button><button class="btn small" data-copy="raw">Copy raw</button></span></div><div class="meta">session '+esc(j.sessionId||'')+' · request '+esc(j.requestId||'')+' · '+esc(j.cwd||'')+'</div><pre class="cmd">'+esc(j.script||'')+'</pre><pre>'+esc(j.stdout||'')+'</pre><pre class="stderr">'+esc(j.stderr||'')+'</pre>';
el.querySelector('[data-copy="cmd"]').onclick=()=>navigator.clipboard.writeText(j.script||'');el.querySelector('[data-copy="out"]').onclick=()=>navigator.clipboard.writeText((j.stdout||'')+(j.stderr?'\n[stderr]\n'+j.stderr:''));el.querySelector('[data-copy="raw"]').onclick=()=>navigator.clipboard.writeText(jobText(j));applyFilter();}
function ingest(e){if(paused){pending.push(e);return;}let j=jobs.get(e.jobId);if(e.type==='job_started'){j={jobId:e.jobId,requestId:e.requestId,sessionId:e.sessionId,status:'running',cwd:e.cwd,script:e.script,note:e.note,stdout:'',stderr:'',at:e.at};jobs.set(e.jobId,j);}else if(j&&e.type==='stdout'){j.stdout+=(e.chunk||'');}else if(j&&e.type==='stderr'){j.stderr+=(e.chunk||'');}else if(j&&e.type==='job_finished'){Object.assign(j,{status:e.status,exitCode:e.exitCode,durationMs:e.durationMs});}else return;render(j);}
fetch('/api/activity?limit=5000',{cache:'no-store'}).then(r=>r.json()).then(j=>{for(const e of (j.events||[]))ingest(e);});
const es=new EventSource('/events');es.onopen=()=>{conn.textContent='live';conn.className='pill ok'};es.onerror=()=>{conn.textContent='reconnecting';conn.className='pill running'};es.addEventListener('activity',ev=>{try{ingest(JSON.parse(ev.data))}catch{}});
filter.oninput=applyFilter;statusSel.onchange=applyFilter;document.getElementById('pause').onclick=e=>{paused=!paused;e.target.textContent=paused?'Resume':'Pause';if(!paused){const q=pending;pending=[];q.forEach(ingest);}};
document.getElementById('copyVisible').onclick=()=>navigator.clipboard.writeText([...jobs.values()].filter(j=>{const el=document.getElementById('j-'+j.jobId);return el&&!el.classList.contains('hidden');}).map(jobText).join('\n\n---\n\n'));
</script></div></body></html>`;
}
