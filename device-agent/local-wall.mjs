import http from 'node:http';
import fs from 'node:fs';

function json(res,status,value){
  const body=JSON.stringify(value);
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(body);
}
function body(req,limit=16*1024){return new Promise((resolve,reject)=>{let size=0,chunks=[];req.on('data',c=>{size+=c.length;if(size>limit){reject(new Error('body_too_large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);});}
function safeText(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function loadBrand(path){try{return fs.readFileSync(path,'utf8');}catch{return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#ffcc00"/><text x="32" y="40" text-anchor="middle" font-size="24" font-weight="800" fill="#080a0c">LR</text></svg>';}}

function page(brandSvg){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote — Local Wall</title><style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#080a0c;color:#edf2f7}*{box-sizing:border-box}body{margin:0;background:#080a0c}.wrap{max-width:900px;margin:auto;padding:24px}.brand{display:flex;align-items:center;gap:14px;margin-bottom:22px}.brand svg{width:52px;height:52px}.muted{color:#8692a3}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{border:1px solid #242d36;background:#0d1116;border-radius:14px;padding:16px}.big{font-size:24px;font-weight:750}.ok{color:#62d99a}.warn{color:#f1c96d}.bad{color:#ff8e8e}.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.btn,select{border:1px solid #34404c;background:#141a21;color:#edf2f7;border-radius:9px;padding:9px 12px;font:inherit}.btn{cursor:pointer}.primary{background:#ffcc00;color:#111;border-color:#ffcc00;font-weight:700}.danger{border-color:#8b3c46;color:#ff9ba5}.sessions{margin-top:14px}.session{border-top:1px solid #202832;padding:10px 0}.session:first-child{border-top:0}.small{font-size:12px}.footer{margin-top:18px;color:#667282;font-size:12px}@media(max-width:600px){.wrap{padding:14px}.big{font-size:20px}}</style></head><body><div class="wrap">
<div class="brand"><div>${brandSvg}</div><div><div class="big">Light Remote</div><div class="muted">Local Wall · this device only</div></div></div>
<div class="grid"><div class="card"><div class="muted small">SERVICE</div><div id="service" class="big ok">Running</div><div id="device" class="muted"></div></div><div class="card"><div class="muted small">CLOUD</div><div id="cloud" class="big">Loading…</div><div id="lease" class="muted"></div></div></div>
<div class="card" style="margin-top:12px"><div class="row"><button id="connect" class="btn primary">Connect</button><button id="disconnect" class="btn danger">Disconnect</button><span class="muted">Reconnect grace</span><select id="grace"><option value="15">15 min</option><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option></select></div><div id="error" class="bad small" style="margin-top:8px"></div></div>
<div class="card sessions"><div class="row" style="justify-content:space-between"><b>Agent sessions</b><span id="sessionCount" class="muted small">0</span></div><div id="sessions" class="muted small">No active sessions.</div></div>
<div class="footer">The background service remains alive while cloud state is Dormant. Connect creates a finite server lease; no terminal needs to stay open.</div></div><script>
const q=id=>document.getElementById(id);let busy=false;
function remaining(exp){if(!exp)return '';const ms=Math.max(0,Number(exp)-Date.now()),m=Math.floor(ms/60000),h=Math.floor(m/60);return h?(h+'h '+(m%60)+'m remaining'):(m+'m remaining');}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
async function call(path,method='GET',payload){const r=await fetch(path,{method,headers:payload?{'content-type':'application/json'}:{},body:payload?JSON.stringify(payload):undefined,cache:'no-store'}),j=await r.json();if(!r.ok||!j.ok)throw new Error(j.error||('http_'+r.status));return j;}
function render(j){const s=j.local||{},remote=j.remote||null,enrolled=!!s.enrolled,connected=enrolled&&s.cloudState==='connected'&&s.cloudDesiredConnected;q('device').textContent=(s.deviceName||s.deviceId||'device')+(s.accountId?' · '+s.accountId:'');q('cloud').textContent=!enrolled?'Not enrolled':connected?'Connected':'Dormant';q('cloud').className='big '+(connected?'ok':'warn');q('lease').textContent=connected?[(s.connectionPlan||'plan').toUpperCase(),remaining(s.hardExpiresAt)].filter(Boolean).join(' · '):'No server channel';q('connect').disabled=busy||connected||!enrolled;q('disconnect').disabled=busy||!connected;if(s.reconnectGraceMs)q('grace').value=String(Math.round(s.reconnectGraceMs/60000));q('grace').disabled=busy||!connected;const rows=remote?.sessions||[];q('sessionCount').textContent=rows.length+' session'+(rows.length===1?'':'s');q('sessions').innerHTML=rows.length?rows.map(x=>'<div class="session"><b>'+esc(x.label||x.sessionId)+'</b> · '+esc(x.state)+'<br><span class="muted">agent '+esc(x.agentId||'')+' · jobs '+(x.activeJobs||[]).length+' · last '+new Date(x.lastSeenAt||Date.now()).toLocaleTimeString()+'</span></div>').join(''):'No active or held Agent sessions.';}
async function refresh(){try{render(await call('/api/status'));q('error').textContent='';}catch(e){q('error').textContent=e.message;}}
async function act(path,payload){if(busy)return;busy=true;q('error').textContent='';try{await call(path,'POST',payload);await refresh();}catch(e){q('error').textContent=e.message;}finally{busy=false;}}
q('connect').onclick=()=>act('/api/connect',{graceMinutes:Number(q('grace').value||30)});q('disconnect').onclick=()=>act('/api/disconnect',{});q('grace').onchange=()=>act('/api/grace',{minutes:Number(q('grace').value)});refresh();setInterval(()=>{if(!document.hidden)refresh();},10000);
</script></body></html>`;}
export function startLocalWall({host='127.0.0.1',port=5491,brandSvgPath,getLocalStatus,getRemoteStatus,connect,disconnect,setGrace}={}){
  if(!['127.0.0.1','::1','localhost'].includes(String(host))) throw new Error('local_wall_non_loopback_not_allowed');
  const brandSvg=loadBrand(brandSvgPath);
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/','http://local.wall');
      if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(page(brandSvg));return;}
      if(req.method==='GET'&&url.pathname==='/api/status'){
        const local=await getLocalStatus();let remote=null;
        if(local?.cloudDesiredConnected&&local?.cloudState==='connected'){try{remote=await getRemoteStatus();}catch(error){remote={ok:false,error:error.message};}}
        return json(res,200,{ok:true,local,remote});
      }
      if(req.method==='POST'&&url.pathname==='/api/connect'){const data=await body(req);const value=await connect(data||{});return json(res,200,{ok:true,connection:value});}
      if(req.method==='POST'&&url.pathname==='/api/disconnect'){const data=await body(req);const value=await disconnect(data||{});return json(res,200,{ok:true,connection:value});}
      if(req.method==='POST'&&url.pathname==='/api/grace'){const data=await body(req);const value=await setGrace(data||{});return json(res,200,{ok:true,connection:value});}
      return json(res,404,{ok:false,error:'not_found'});
    }catch(error){return json(res,Number(error.status)||400,{ok:false,error:error.message||'local_wall_error'});}
  });
  server.listen(Number(port),host);
  return {server,host,port:Number(port),url:`http://${host}:${Number(port)}/`,close:()=>new Promise(resolve=>server.close(()=>resolve()))};
}
