// M6 Fleet Wall job overview. Owner-authenticated and read-only.
export function fleetJobPage(){
return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Light Remote — Fleet Jobs</title><style>
:root{font:14px system-ui;color-scheme:dark;background:#080a0c;color:#d7e3ef}*{box-sizing:border-box}body{margin:0}
main{max-width:1400px;margin:auto;padding:22px}header{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap}
h1{font-size:23px;margin:8px 0}p,small{color:#9caebf;line-height:1.5}a{color:#6dcaf1}button,select{padding:8px 12px;background:#121c26;color:#e2edf6;border:1px solid #314b63;border-radius:8px;cursor:pointer}
section{border:1px solid #23313f;border-radius:10px;overflow:auto;margin-top:18px}table{width:100%;border-collapse:collapse;min-width:900px}td,th{text-align:left;border-bottom:1px solid #1b2a36;padding:11px}th{color:#9ebbd0;background:#0e1822}code{font-size:12px;color:#b9ddf5}.queued{color:#f0c672}.running{color:#79d4ec}.ok{color:#85daa9}.error{color:#f5a0a0}
@media(max-width:700px){main{padding:12px}td,th{padding:8px}}
</style></head><body><main><header><div><a href="/">← Fleet Wall</a><h1>Jobs & Queue</h1><small>Owner account · all registered devices · read-only overview</small></div><div><select id="filter"><option value="">All states</option><option>running</option><option>queued</option><option>ok</option><option>error</option></select> <button id="refresh">Refresh</button></div></header>
<p>Execution slots, per-device worker budgets and resource locks are independent. A process launch marked OK is not a completed background process. UNKNOWN must not be interpreted as successful execution. This overview does not cancel jobs; local owner controls remain on each device's Processes page.</p>
<p id="status" role="status">Loading…</p><section><table><thead><tr><th>Status</th><th>Device</th><th>Agent</th><th>Job</th><th>Work class</th><th>Queue reason</th><th>Started</th><th>Output</th></tr></thead><tbody id="rows"></tbody></table></section></main>
<script>
const rows=document.getElementById('rows'),message=document.getElementById('status'),filter=document.getElementById('filter');
let all=[];
const cell=(tr,value)=>{const td=document.createElement('td');td.textContent=String(value??'—');tr.append(td);return td};
function render(){rows.replaceChildren();const found=all.filter(j=>!filter.value||j.status===filter.value);for(const j of found){const tr=document.createElement('tr');cell(tr,j.status).className=['queued','running','ok','error'].includes(j.status)?j.status:'';cell(tr,j.deviceName||j.deviceId);cell(tr,j.agentId);cell(tr,j.jobId);cell(tr,j.workerClass+(j.jobRole==='process_launch'?' · launch':''));
cell(tr,j.queueReason||'—');cell(tr,j.startedAt?new Date(j.startedAt).toLocaleString():'—');cell(tr,j.outputBytes==null?'not retained':String(j.outputBytes)+' B');rows.append(tr)}
message.textContent=found.length+' visible jobs · '+all.length+' scoped jobs. PostgreSQL history + current live Operator state.'}
async function refresh(){const r=await fetch('/api/jobs?limit=200',{cache:'no-store'}),v=await r.json();if(!r.ok||!v.ok)throw Error(v.error||'fleet_jobs_unavailable');all=v.jobs||[];render()}
document.getElementById('refresh').onclick=()=>refresh().catch(e=>message.textContent=e.message);
filter.onchange=render;refresh().catch(e=>message.textContent=e.message);
setInterval(()=>{if(!document.hidden)refresh().catch(e=>message.textContent=e.message)},10000);
</script></body></html>`;
}