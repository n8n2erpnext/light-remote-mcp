// Gold UAT: four independently authorized OAuth MCP clients.
// Owner-driven A/B pairing. No credentials or access tokens written to disk.
// Start from an owner-controlled desktop using: node gold-uat-four-oauth-clients.mjs
import http from 'node:http';
import crypto from 'node:crypto';

const ORIGIN='https://gold.light-remote.thaiduy.digital';
const RESOURCE=ORIGIN+'/mcp';
const SCOPE='remote:read remote:write remote:execute remote:terminal openid email';
const slots=['A','B','C','D'].map(label=>({label,stage:'new',clientId:null,token:null,verifier:null,state:null,authorizeUrl:null,code:null,account:null,bCode:null,devices:[],error:null}));
let baseUrl='',requestId=0;
const csrf=crypto.randomBytes(24).toString('base64url');
const digest=v=>crypto.createHash('sha256').update(v).digest('base64url');
const random=()=>crypto.randomBytes(24).toString('base64url');
const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function respond(res,status,body,contentType='text/html; charset=utf-8'){
  res.writeHead(status,{'content-type':contentType,'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none';"});
  res.end(body);
}
const redirect=res=>{res.writeHead(303,{location:'/', 'cache-control':'no-store'});res.end();};
function form(path,index,text,extra=''){
 return '<form method="post" action="'+path+'"><input type="hidden" name="csrf" value="'+csrf+'"><input type="hidden" name="i" value="'+index+'">'+extra+'<button>'+text+'</button></form>';
}
function testForm(){
 const ready=slots.every(s=>s.stage==='ready');
 const same=ready&&slots.every(s=>s.account===slots[0].account);
 const unique=ready&&new Set(slots.map(s=>s.agentKey)).size===4;
 const details='<h3>Real 3+1 gate</h3><p>'+htmlEscape(test.state)+': '+htmlEscape(test.detail)+
   ' / fourth queued seen: '+test.observedFourthQueued+'</p><p>'+
   test.jobs.filter(Boolean).map(j=>htmlEscape(j.client+': '+j.state+' / '+j.jobId)).join(' | ')+'</p>';
 if(!ready||!same||!unique)return details;
 const selects=slots.map((s,i)=>'<label>Agent '+s.label+' <select name="device'+i+'">'+s.devices.map(d=>'<option value="'+htmlEscape(d.deviceId)+'">'+htmlEscape((d.name||d.deviceId)+' ('+d.platform+')')+'</option>').join('')+'</select></label> ').join('');
 return details+(test.state==='not_started'?'<p>Owner-approved devices only; maximum two sessions/device. Commands: read-only, bounded 22-second foreground sleep. PostgreSQL evidence is an independent gate.</p><form method="post" action="/test"><input type="hidden" name="csrf" value="'+csrf+'">'+selects+'<button>Run bounded 3+1 UAT</button></form>':'');
}
function view(){
 const ready=slots.filter(s=>s.stage==='ready'),oneAccount=ready.length===4&&ready.every(s=>s.account===ready[0].account);
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Gold UAT 3+1 OAuth clients</title><style>body{font:15px system-ui;background:#0b1320;color:#e6eef8;max-width:980px;margin:25px auto;padding:0 15px}section{border:1px solid #31516b;border-radius:12px;padding:16px;margin:12px 0}a{color:#72d6ff}button,input{font:inherit;padding:8px;margin:5px 0;border-radius:5px}input{background:#152638;color:white;border:1px solid #46708d}button{cursor:pointer}code{color:#92f1d2}form{display:inline-block;margin-right:10px}small{color:#adc0d6}</style><h1>Light Remote Gold — real OAuth clients A/B/C/D</h1><p>UAT only: <code>'+ORIGIN+'</code>. Four separate OAuth dynamic registrations, with PKCE + owner A/B. No simulated IDs, no automatic device access. Passwords are entered directly on Gold OAuth pages, never into this local harness. Tokens remain in process memory.</p>'+
 slots.map((s,i)=>'<section><h2>Client '+s.label+' — '+htmlEscape(s.stage)+'</h2><p>'+htmlEscape(s.error||'')+'</p>'+
  (s.stage==='new'?form('/start',i,'Register and authorize '+s.label):'')+
  (s.stage==='authorize'?'<p><a target="_blank" rel="noreferrer" href="'+htmlEscape(s.authorizeUrl)+'">Authorize client '+s.label+' on Gold</a></p>':'')+
  (s.stage==='oauth-approved'?'<p>OAuth approved. Enter a fresh Local Wall A code from an authorized Gold UAT device:</p>'+form('/pair',i,'Request Local Wall B code','<input name="aCode" autocomplete="off" pattern="[A-Za-z2-9-]{8,9}" required placeholder="XXXX-XXXX">'):'')+
  (s.stage==='approval-required'?'<p>Local Wall B code: <strong><code>'+htmlEscape(s.bCode)+'</code></strong>. Enter B on the same Gold device Local Wall /approve, choose Approve, then:</p>'+form('/resume',i,'Check owner approval'):'')+
  (s.stage==='ready'?'<p>OAuth + device approval ready. Gold-visible devices: '+htmlEscape(s.devices.map(d=>d.name||d.deviceId).join(', '))+'.</p>':'')+
  '</section>').join('')+
 '<p><strong>Independent verified clients:</strong> '+ready.length+'/4. <strong>Same OAuth account:</strong> '+(ready.length===4?(oneAccount?'YES':'NO — STOP'):'not yet verified')+'.</p>'+
 '<p><small>Next gate (separate): assign approved devices and run three overlapping foreground Agent leases plus fourth QUEUED_AGENT_SLOT with PostgreSQL receipts. This page only establishes real authorized principals; it does not manufacture scheduler PASS.</small></p>'+
 testForm()+form('/stop',-1,'End UAT and forget in-memory tokens')+'</html>';
}
async function fetchJson(url,opts){
 const r=await fetch(url,{...opts,redirect:'manual',signal:AbortSignal.timeout(15000)});
 let obj={};try{obj=await r.json();}catch{}
 if(!r.ok)throw Error('HTTP_'+r.status+':'+String(obj.error||'request_failed').slice(0,70));
 return obj;
}
async function tool(s,name,args={}){
 if(!s.token)throw Error('oauth_access_required');
 const body={jsonrpc:'2.0',id:++requestId,method:'tools/call',params:{name,arguments:args}};
 const r=await fetchJson(RESOURCE,{method:'POST',headers:{'content-type':'application/json','accept':'application/json, text/event-stream',authorization:'Bearer '+s.token},body:JSON.stringify(body)});
 const result=r.result||{};
 if(result.isError)throw Error('mcp_'+String(result.structuredContent?.error||'tool_denied').slice(0,80));
 return result.structuredContent||{};
}
async function begin(i){
 const s=slots[i];if(!s||s.stage!=='new')throw Error('client_not_new');
 const reg=await fetchJson(ORIGIN+'/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:'Gold UAT Pro 3plus1 '+s.label,redirect_uris:[baseUrl+'/callback'],grant_types:['authorization_code'],response_types:['code'],token_endpoint_auth_method:'none'})});
 s.clientId=reg.client_id;s.verifier=random()+random();s.state=random();const challenge=digest(s.verifier);
 const u=new URL(ORIGIN+'/oauth/authorize');u.search=new URLSearchParams({client_id:s.clientId,redirect_uri:baseUrl+'/callback',response_type:'code',code_challenge:challenge,code_challenge_method:'S256',resource:RESOURCE,scope:SCOPE,state:s.state}).toString();
 s.authorizeUrl=u.toString();s.stage='authorize';s.error=null;
}
async function callback(url){
 const state=url.searchParams.get('state'),code=url.searchParams.get('code'),s=slots.find(x=>x.stage==='authorize'&&x.state===state);
 if(!s||!code)throw Error('invalid_oauth_callback_state');
 const body=new URLSearchParams({grant_type:'authorization_code',client_id:s.clientId,code,redirect_uri:baseUrl+'/callback',code_verifier:s.verifier,resource:RESOURCE});
 const tok=await fetchJson(ORIGIN+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
 if(typeof tok.access_token!=='string')throw Error('oauth_token_missing');
 const registeredClientId=s.clientId;s.token=tok.access_token;s.verifier=null;s.state=null;s.authorizeUrl=null;s.clientId=null;
 const user=await fetchJson(ORIGIN+'/userinfo',{headers:{authorization:'Bearer '+s.token}});
 s.account=String(user.sub||'');if(!s.account)throw Error('oauth_subject_missing');s.agentKey='plugin-'+crypto.createHash('sha256').update(s.account+'|'+registeredClientId).digest('hex').slice(0,40);
 s.stage='oauth-approved';s.error=null;
}
async function pair(i,aCode){
 const s=slots[i];if(!s||s.stage!=='oauth-approved')throw Error('oauth_not_approved');
 if(!/^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/.test(aCode))throw Error('invalid_local_wall_a_code');
 const x=await tool(s,'light_remote_connection_helper',{aCode,label:'Gold UAT Pro 3plus1 Agent '+s.label});
 if(x.status==='approval_required'&&/^[A-Za-z2-9]{4}-?[A-Za-z2-9]{4}$/.test(String(x.code||''))){s.bCode=x.code;s.stage='approval-required';return;}
 if(x.status==='ready'){s.stage='ready';s.devices=x.topology||[];s.plan=x.account?.plan||null;return;}
 throw Error('pairing_'+String(x.status||'unknown'));
}
async function resume(i){
 const s=slots[i];if(!s||s.stage!=='approval-required')throw Error('approval_not_pending');
 const x=await tool(s,'light_remote_connection_helper',{});
 if(x.status==='ready'){s.stage='ready';s.bCode=null;s.devices=x.topology||[];s.plan=x.account?.plan||null;return;}
 if(x.status!=='approval_required')throw Error('pairing_'+String(x.status||'unknown'));
 s.bCode=x.code||s.bCode;
}
// A real device-control run; SQL queue reasons and signed PG ownership are a
// separate read-only verification gate on ARM, never inferred from this page.
const test={state:'not_started',detail:'',jobs:[],observedFourthQueued:false};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function jobRow(i,id,state='submitted'){return {client:slots[i].label,jobId:id,state};}
async function readJob(i,id){return tool(slots[i],'light_remote_job',{jobId:id});}
async function runProTest(devices){
 test.state='running';test.detail='Opening explicitly selected Gold sessions';
 const sessions=[];
 try{
  const owners=slots.map(s=>s.account);
  if(slots.some(s=>s.stage!=='ready')||new Set(owners).size!==1)throw Error('four_approved_clients_same_account_required');
  if(new Set(slots.map(s=>s.agentKey)).size!==4)throw Error('distinct_signed_oauth_clients_required');
  if(slots.some(s=>!['pro','vip'].includes(String(s.plan||''))))throw Error('pro_plan_required');
  const targetCounts=new Map();
  for(let i=0;i<4;i++){
   const d=slots[i].devices.find(x=>x.deviceId===devices[i]);
   if(!d)throw Error('target_not_owner_approved_for_'+slots[i].label);
   targetCounts.set(d.deviceId,(targetCounts.get(d.deviceId)||0)+1);
   if(targetCounts.get(d.deviceId)>2)throw Error('test_session_limit_two_per_device');
  }
  for(let i=0;i<4;i++){
   const row=await tool(slots[i],'light_remote_open_session',{deviceId:devices[i],workspace:'',gracePreset:'60m'});
   const session=row.session||row;
   if(!session?.sessionId||session.deviceId!==devices[i])throw Error('session_identity_or_device_mismatch_'+slots[i].label);
   sessions[i]=session.sessionId;
  }
  const runOne=async i=>{
   const device=slots[i].devices.find(x=>x.deviceId===devices[i]),win=String(device.platform)==='win32';
   const command=win?
    'Write-Output UAT_'+slots[i].label+'_START; Start-Sleep -Seconds 22; Write-Output UAT_'+slots[i].label+'_DONE':
    'printf UAT_'+slots[i].label+'_START; sleep 22; printf UAT_'+slots[i].label+'_DONE';
   const response=await tool(slots[i],'light_remote_exec',{sessionId:sessions[i],script:command,cwd:win?'C:\\Users\\Public':'/tmp',waitMs:0,timeoutMs:37000,executionMode:'foreground'});
   const id=response.job?.jobId||response.jobId;
   if(!/^[A-Za-z0-9._:-]{1,160}$/.test(String(id||'')))throw Error('missing_job_id_'+slots[i].label);
   test.jobs[i]=jobRow(i,id,response.job?.state||response.state||'submitted');
  };
  test.detail='Submitting A, B, C together (foreground read-only zero-weight candidate)';
  await Promise.all([runOne(0),runOne(1),runOne(2)]);
  let three=false;
  for(let n=0;n<25;n++){
   const statuses=await Promise.all([0,1,2].map(async i=>{const row=await readJob(i,test.jobs[i].jobId);test.jobs[i].state=row.state;return row.state;}));
   if(statuses.every(s=>s==='running')){three=true;break;}
   if(statuses.some(s=>['error','timeout','ok','finished','cancelled'].includes(s)))break;
   await delay(400);
  }
  if(!three)throw Error('three_execution_leases_not_overlapping_check_transport');
  test.detail='Three running Agent jobs reported. Submitting fourth now';
  await runOne(3);
  for(let n=0;n<14;n++){
   const row=await readJob(3,test.jobs[3].jobId);test.jobs[3].state=row.state;
   if(row.state==='queued'){test.observedFourthQueued=true;break;}
   if(['ok','error','timeout'].includes(row.state))break;
   await delay(400);
  }
  if(!test.observedFourthQueued)throw Error('fourth_not_observed_queued');
  test.detail='Fourth was queued. Polling completion and promotion';
  let allFinished=false;
  for(let n=0;n<140;n++){
   const statuses=await Promise.all([0,1,2,3].map(async i=>{const row=await readJob(i,test.jobs[i].jobId);test.jobs[i].state=row.state;return row.state;}));
   if(statuses.every(s=>['ok','error','timeout'].includes(s))){allFinished=true;break;}
   await delay(400);
  }
  if(!allFinished)throw Error('bounded_job_completion_window_expired');
  if(test.jobs.some(j=>j.state!=='ok'))throw Error('one_or_more_jobs_nonzero');
  test.state='mcp_pass_pg_pending';
  test.detail='4 authorized clients: A/B/C active overlap, D queued then finished. Verify PG QUEUED_AGENT_SLOT, signed agentId and receipts before final acceptance.';
 }catch(e){test.state='blocked';test.detail=String(e?.message||'unknown').slice(0,120);}
 finally{
  // Leave sessions open on uncertain jobs to allow owner reconciliation.
  if(test.jobs.length===4&&test.jobs.every(j=>j?.state==='ok')){
   await Promise.allSettled(sessions.map((id,i)=>id?tool(slots[i],'light_remote_close_session',{sessionId:id}):Promise.resolve()));
  }
 }
}
function parseBody(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',d=>{raw+=d;if(raw.length>2000)reject(Error('request_too_large'));});req.on('end',()=>resolve(new URLSearchParams(raw)));req.on('error',reject);});}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,baseUrl||'http://127.0.0.1');
 try{
  if(req.method==='GET'&&u.pathname==='/'){respond(res,200,view());return;}
  if(req.method==='GET'&&u.pathname==='/callback'){await callback(u);redirect(res);return;}
  if(req.method!=='POST'||!['/start','/pair','/resume','/stop','/test'].includes(u.pathname)){respond(res,404,'Not found','text/plain');return;}
  const localOrigin=String(req.headers.origin||'');
  if(localOrigin&&localOrigin!==baseUrl)throw Error('origin_mismatch');
  const body=await parseBody(req);if(body.get('csrf')!==csrf)throw Error('csrf_mismatch');
  if(u.pathname==='/stop'){if(test.state==='running')throw Error('test_still_running');respond(res,200,'Gold UAT harness stopped. All in-memory tokens discarded.','text/plain');server.close();process.exitCode=0;return;}
  if(u.pathname==='/test'){
   if(test.state!=='not_started')throw Error('test_already_started');
   const devices=[0,1,2,3].map(i=>String(body.get('device'+i)||''));
   void runProTest(devices);
   redirect(res);return;
  }
  const i=Number(body.get('i'));if(!Number.isInteger(i)||i<0||i>=4)throw Error('invalid_client_index');
  if(u.pathname==='/start')await begin(i);
  if(u.pathname==='/pair')await pair(i,String(body.get('aCode')||'').trim());
  if(u.pathname==='/resume')await resume(i);
  redirect(res);
 }catch(e){
  const i=Number((u.pathname==='/callback'?'-1':undefined)||-1);
  // Never render remote responses, tokens, OAuth codes or full URLs.
  respond(res,400,'Gold UAT step failed: '+htmlEscape(String(e?.message||'unknown').slice(0,110))+' <a href="/">Back</a>');
 }
});
server.listen(0,'127.0.0.1',()=>{baseUrl='http://127.0.0.1:'+server.address().port;console.log('Gold UAT four-client OAuth harness: '+baseUrl);console.log('Credentials and tokens are never printed or persisted.');});
