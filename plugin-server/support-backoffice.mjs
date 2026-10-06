import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { callOperatorJson } from './operator-client.mjs';
import { PUBLIC_ORIGIN } from './config.mjs';
import { redactRestrictedText } from './response-sanitizer.mjs';

const ACCOUNT_COOKIE='__Host-light_remote_account';
const DEFAULT_STATE_FILE=String(process.env.LIGHT_REMOTE_SUPPORT_OUTBOX_FILE||'/var/lib/light-remote-direct/plugin-state/support-outbox.json');
const DEFAULT_CONFIG_FILE=String(process.env.LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE||'/etc/light-remote-direct/backoffice.json');
const ELIGIBLE_PLANS=new Set(['pro','vip']);
const MAX_PENDING=5000;
const MAX_SENT_HISTORY=500;
const SUPPORT_AREAS=new Set(['install','approval','remote','account','update','billing','security','other']);
const submitRate=new Map();

function parseCookies(header=''){
  const out={};
  for(const part of String(header).split(';')){
    const i=part.indexOf('=');
    if(i<1)continue;
    out[part.slice(0,i).trim()]=decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}
function sessionToken(req){return String(parseCookies(req.headers?.cookie||'')[ACCOUNT_COOKIE]||'');}
function accountHeaders(token){return token?{'x-light-account-session':token}:{};}
function sameOriginMutation(req){
  const site=String(req.headers?.['sec-fetch-site']||'').toLowerCase();
  if(site==='cross-site')return false;
  if(site==='same-origin')return true;
  const origin=String(req.headers?.origin||'').trim();
  if(!origin)return true;
  try{
    if(new URL(origin).origin===PUBLIC_ORIGIN)return true;
    const host=String(req.headers?.['x-forwarded-host']||req.headers?.host||'').split(',')[0].trim();
    return new URL(origin).host===host;
  }catch{return false;}
}
function cleanText(value,{max=2000,required=false,field='field'}={}){
  const raw=String(value??'').trim();
  if(required&&!raw)throw Object.assign(new Error(field+'_required'),{status:400});
  if(raw.length>max)throw Object.assign(new Error(field+'_too_long'),{status:400});
  const redacted=redactRestrictedText(raw);
  if(redacted!==raw)throw Object.assign(new Error('support_contains_sensitive_material'),{status:400});
  return raw;
}
function safeError(error){return redactRestrictedText(String(error?.message||error||'backoffice_delivery_failed')).slice(0,500);}
function supportView(row){
  return {
    eventId:row.eventId,
    status:row.status,
    attempts:row.attempts,
    createdAt:row.createdAt,
    deliveredAt:row.deliveredAt||null,
    nextAttemptAt:row.nextAttemptAt||null,
    remoteStatus:row.remoteStatus||null,
    resultName:row.resultName||null,
    statusCheckAttempts:Number(row.statusCheckAttempts||0),
    lastError:row.lastError||null,
  };
}
function backoffMs(attempts){
  const ladder=[5_000,15_000,30_000,60_000,2*60_000,5*60_000,10*60_000,30*60_000,60*60_000];
  return ladder[Math.min(Math.max(0,attempts-1),ladder.length-1)];
}
function allowSubmit(accountId,{limit=12,windowMs=60*60_000,now=Date.now()}={}){
  const key=String(accountId||'');
  const rows=(submitRate.get(key)||[]).filter(ts=>ts>now-windowMs);
  if(rows.length>=limit){submitRate.set(key,rows);return false;}
  rows.push(now);submitRate.set(key,rows);return true;
}
function loadConfig(configFile){
  const row=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(row?.schemaVersion!==1)throw new Error('backoffice_config_schema_invalid');
  const endpoint=String(row.endpoint||'').trim();
  if(!/^https?:\/\//.test(endpoint))throw new Error('backoffice_endpoint_invalid');
  const authMode=String(row.authMode||'token').trim().toLowerCase();
  const apiKey=String(row.apiKey||'').trim(),apiSecret=String(row.apiSecret||'').trim();
  if(authMode==='token'&&(!apiKey||!apiSecret))throw new Error('backoffice_credentials_missing');
  if(!['token','internal-network'].includes(authMode))throw new Error('backoffice_auth_mode_invalid');
  return {endpoint,authMode,apiKey,apiSecret,siteHost:String(row.siteHost||'').trim()};
}

export class SupportOutbox{
  constructor({stateFile=DEFAULT_STATE_FILE,configFile=DEFAULT_CONFIG_FILE,fetchImpl=globalThis.fetch,now=()=>Date.now()}={}){
    this.stateFile=stateFile;
    this.configFile=configFile;
    this.fetchImpl=fetchImpl;
    this.now=now;
    this.rows=[];
    this.pumping=false;
    this._load();
  }
  _load(){
    try{
      if(!this.stateFile||!fs.existsSync(this.stateFile))return;
      const data=JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      if(data?.schemaVersion!==1||!Array.isArray(data.rows))return;
      this.rows=data.rows.filter(row=>row&&row.eventId&&row.accountId&&row.payload);
    }catch(error){console.error('[support-outbox-load]',safeError(error));}
  }
  _persist(){
    if(!this.stateFile)return;
    const dir=path.dirname(this.stateFile);
    fs.mkdirSync(dir,{recursive:true,mode:0o750});
    const tmp=`${this.stateFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp,`${JSON.stringify({schemaVersion:1,rows:this.rows},null,2)}\n`,{mode:0o600});
    fs.chmodSync(tmp,0o600);
    fs.renameSync(tmp,this.stateFile);
  }
  _compact(){
    const pending=this.rows.filter(row=>row.status!=='sent');
    const sent=this.rows.filter(row=>row.status==='sent').sort((a,b)=>Number(b.deliveredAt||0)-Number(a.deliveredAt||0)).slice(0,MAX_SENT_HISTORY);
    this.rows=[...pending,...sent].sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
  }
  enqueue({account,payload,eventId=null}){
    const pendingCount=this.rows.filter(row=>row.status!=='sent').length;
    if(pendingCount>=MAX_PENDING)throw Object.assign(new Error('support_queue_full'),{status:503});
    const id=eventId||`lr.support.${crypto.randomUUID()}`;
    const existing=this.rows.find(row=>row.eventId===id);
    if(existing)return supportView(existing);
    const now=this.now();
    const row={
      eventId:id,
      accountId:String(account.accountId),
      accountEmail:String(account.email),
      accountPlan:String(account.plan||'free').toLowerCase(),
      payload:{...payload,event_id:id},
      status:'queued',
      attempts:0,
      createdAt:now,
      nextAttemptAt:now,
      deliveredAt:null,
      remoteStatus:null,
      resultName:null,
      statusCheckAttempts:0,
      nextStatusCheckAt:null,
      lastError:null,
    };
    this.rows.push(row);
    this._persist();
    return supportView(row);
  }
  get(eventId,accountId){
    const row=this.rows.find(item=>item.eventId===String(eventId||'')&&item.accountId===String(accountId||''));
    return row?supportView(row):null;
  }
  async pump({limit=8}={}){
    if(this.pumping)return {ok:true,skipped:true};
    this.pumping=true;
    let delivered=0,failed=0;
    try{
      const config=loadConfig(this.configFile);
      const now=this.now();
      const due=this.rows.filter(row=>row.status!=='sent'&&Number(row.nextAttemptAt||0)<=now).slice(0,limit);
      for(const row of due){
        try{
          await this._deliver(row,config);
          delivered++;
        }catch(error){
          row.attempts=Number(row.attempts||0)+1;
          row.status='queued';
          row.lastError=safeError(error);
          row.nextAttemptAt=this.now()+backoffMs(row.attempts);
          failed++;
        }
        this._compact();
        this._persist();
      }
      const resolved=await this._refreshResults(config,{limit});
      return {ok:true,delivered,failed,resolved,pending:this.rows.filter(row=>row.status!=='sent').length};
    }finally{this.pumping=false;}
  }
  async _deliver(row,config){
    const headers={
      'content-type':'application/json',
      'accept':'application/json',
    };
    if(config.authMode==='token')headers.authorization=`token ${config.apiKey}:${config.apiSecret}`;
    if(config.siteHost)headers.host=config.siteHost;
    const response=await this.fetchImpl(config.endpoint,{
      method:'POST',
      headers,
      body:JSON.stringify(row.payload),
      signal:AbortSignal.timeout(12_000),
    });
    const text=await response.text();
    let body={};
    try{body=text?JSON.parse(text):{};}catch{}
    if(!response.ok)throw new Error(`backoffice_http_${response.status}:${body?.exception||body?.message||text.slice(0,180)}`);
    const message=body?.message||body||{};
    if(message?.accepted!==true)throw new Error('backoffice_event_not_accepted');
    row.status='sent';
    row.deliveredAt=this.now();
    row.nextAttemptAt=null;
    row.lastError=null;
    row.remoteStatus=String(message.status||'Received');
    row.resultName=message.result_name?String(message.result_name):null;
    row.statusCheckAttempts=0;
    row.nextStatusCheckAt=row.resultName?null:this.now();
  }
  _statusEndpoint(config,eventId){
    const url=new URL(config.endpoint);
    const method=config.authMode==='internal-network'
      ?'get_support_case_status_internal'
      :'get_event_status';
    url.pathname=url.pathname.replace(/[^/]+$/,method);
    url.search='';
    url.searchParams.set('event_id',eventId);
    return url.toString();
  }
  async _refreshOne(row,config){
    const headers={'accept':'application/json'};
    if(config.authMode==='token')headers.authorization=`token ${config.apiKey}:${config.apiSecret}`;
    if(config.siteHost)headers.host=config.siteHost;
    const response=await this.fetchImpl(this._statusEndpoint(config,row.eventId),{
      method:'GET',
      headers,
      signal:AbortSignal.timeout(8_000),
    });
    const text=await response.text();
    let body={};
    try{body=text?JSON.parse(text):{};}catch{}
    if(!response.ok)throw new Error(`backoffice_status_http_${response.status}:${body?.exception||body?.message||text.slice(0,180)}`);
    const message=body?.message||body||{};
    const remoteStatus=String(message.status||'');
    if(!remoteStatus)throw new Error('backoffice_status_invalid');
    row.remoteStatus=remoteStatus;
    row.statusCheckAttempts=Number(row.statusCheckAttempts||0)+1;
    if(message.result_name)row.resultName=String(message.result_name);
    if(remoteStatus==='Succeeded'&&row.resultName){
      row.nextStatusCheckAt=null;
      row.lastError=null;
      return true;
    }
    if(remoteStatus==='Failed'){
      row.attempts=Number(row.attempts||0)+1;
      row.status='queued';
      row.nextAttemptAt=this.now()+backoffMs(row.attempts);
      row.nextStatusCheckAt=null;
      row.lastError='backoffice_processing_failed';
      return false;
    }
    const statusDelay=Math.min(60_000,2_000*Math.max(1,row.statusCheckAttempts));
    row.nextStatusCheckAt=this.now()+statusDelay;
    return false;
  }
  async _refreshResults(config,{limit=8}={}){
    const now=this.now();
    const rows=this.rows
      .filter(row=>row.status==='sent'&&!row.resultName&&Number(row.nextStatusCheckAt||0)<=now)
      .slice(0,limit);
    let resolved=0;
    for(const row of rows){
      try{
        if(await this._refreshOne(row,config))resolved++;
      }catch(error){
        row.statusCheckAttempts=Number(row.statusCheckAttempts||0)+1;
        row.nextStatusCheckAt=this.now()+Math.min(60_000,5_000*Math.max(1,row.statusCheckAttempts));
        row.lastError=safeError(error);
      }
      this._compact();
      this._persist();
    }
    return resolved;
  }
}

async function accountIdentity(req){
  const token=sessionToken(req);
  if(!token)return {signedIn:false,token:null,account:null};
  const me=await callOperatorJson('GET','/v1/accounts/me',null,accountHeaders(token));
  const account=me?.account||null;
  if(!account?.accountId||!account?.email)return {signedIn:false,token:null,account:null};
  return {signedIn:true,token,account};
}
function fail(res,error){
  const status=Number(error?.status)||502;
  return res.status(status).json({ok:false,error:String(error?.message||'support_unavailable')});
}
function supportPayload(account,body={}){
  const area=String(body.problemArea||'other').trim().toLowerCase();
  if(!SUPPORT_AREAS.has(area))throw Object.assign(new Error('invalid_problem_area'),{status:400});
  const subject=cleanText(body.subject,{max:240,required:true,field:'subject'});
  const description=cleanText(body.description,{max:12000,required:true,field:'description'});
  const diagnostics={
    problem_area:area,
    target_os_arch:cleanText(body.targetOsArch,{max:160,field:'target_os_arch'}),
    target_client_version:cleanText(body.targetVersion,{max:120,field:'target_version'}),
    device_status:cleanText(body.deviceStatus,{max:40,field:'device_status'}),
    sanitized_error:cleanText(body.sanitizedError,{max:4000,field:'sanitized_error'}),
    steps_before_failure:cleanText(body.steps,{max:6000,field:'steps'}),
    expected_result:cleanText(body.expected,{max:3000,field:'expected'}),
    browser_platform:cleanText(body.browserPlatform,{max:120,field:'browser_platform'}),
    browser_user_agent:cleanText(body.browserUserAgent,{max:500,field:'browser_user_agent'}),
  };
  return {
    source_product:'Light Remote',
    account_email:String(account.email).toLowerCase(),
    account_plan:String(account.plan||'free').toUpperCase(),
    account_id:String(account.accountId),
    source_reference:'web-support',
    subject,
    description,
    diagnostics,
  };
}

export function registerSupportBackoffice(app,{outbox=new SupportOutbox()}={}){
  const first=setTimeout(()=>void outbox.pump().catch(error=>console.error('[support-outbox]',safeError(error))),2_000);first.unref?.();
  const timer=setInterval(()=>void outbox.pump().catch(error=>console.error('[support-outbox]',safeError(error))),10_000);timer.unref?.();

  app.get('/support/api',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const identity=await accountIdentity(req);
      const action=String(req.query?.action||'eligibility');
      if(action==='eligibility'){
        const plan=String(identity.account?.plan||'free').toLowerCase();
        return res.status(200).json({
          ok:true,
          signedIn:identity.signedIn,
          eligible:identity.signedIn&&ELIGIBLE_PLANS.has(plan),
          account:identity.signedIn?{email:identity.account.email,plan}:null,
        });
      }
      if(action==='status'){
        if(!identity.signedIn)return res.status(401).json({ok:false,error:'account_session_required'});
        const row=outbox.get(String(req.query?.eventId||''),identity.account.accountId);
        if(!row)return res.status(404).json({ok:false,error:'support_event_not_found'});
        return res.status(200).json({ok:true,event:row});
      }
      return res.status(400).json({ok:false,error:'unknown_support_action'});
    }catch(error){return fail(res,error);}
  });

  app.post('/support/api',async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!sameOriginMutation(req))return res.status(403).json({ok:false,error:'cross_site_request_denied'});
    try{
      const identity=await accountIdentity(req);
      if(!identity.signedIn)return res.status(401).json({ok:false,error:'account_session_required'});
      const plan=String(identity.account.plan||'free').toLowerCase();
      if(!ELIGIBLE_PLANS.has(plan))return res.status(403).json({ok:false,error:'support_plan_required',plan});
      if(!allowSubmit(identity.account.accountId))return res.status(429).json({ok:false,error:'support_rate_limited'});
      const payload=supportPayload(identity.account,req.body||{});
      const queued=outbox.enqueue({account:identity.account,payload});
      return res.status(202).json({ok:true,accepted:true,event:queued});
    }catch(error){return fail(res,error);}
  });

  return {outbox,timer,first};
}
