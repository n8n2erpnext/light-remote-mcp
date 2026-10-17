import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE=process.env.LIGHT_REMOTE_SITE_ANALYTICS_PATH||'/var/lib/light-remote-direct/plugin-state/site-analytics.json';
const TRACKED=new Set(['/','/downloads','/support','/ai-guide','/privacy','/terms','/cookies']);
const goldPgMode=process.env.LR_GOLD_SITE_ANALYTICS_PG==='1';
let goldPgRepository=null;
let goldWriteFailure=null;
const goldWrites=new Set();
export function configureGoldPgSiteAnalytics(repo){
 if(!goldPgMode||goldPgRepository||!repo||typeof repo.record!=='function'||typeof repo.summary!=='function')
  throw Error('gold_site_analytics_pg_repository_invalid');
 goldPgRepository=repo;
}
const goldStore=()=>{if(!goldPgRepository)throw Error('gold_site_analytics_pg_not_ready');return goldPgRepository};
const saveGoldEvent=(type,attrs)=>{
 const promise=goldStore().record(type,attrs);
 goldWrites.add(promise);
 void promise.finally(()=>goldWrites.delete(promise)).catch(()=>{});
 return promise;
};
let days={};
if(!goldPgMode){try{const state=JSON.parse(fs.readFileSync(FILE,'utf8'));if(state?.days&&typeof state.days==='object')days=state.days}catch{}}
let pending=false;
let changed=false;
function persist(){
 if(goldPgMode)throw Error('gold_site_analytics_json_fallback_forbidden');
 if(!changed)return;
 try{
  fs.mkdirSync(path.dirname(FILE),{recursive:true,mode:0o750});
  const temp=FILE+'.'+process.pid+'.tmp';
  fs.writeFileSync(temp,JSON.stringify({version:1,days}),{mode:0o640});
  fs.renameSync(temp,FILE);changed=false;
 }catch(error){console.error('[site-analytics-write]',error?.message||error)}
}
if(!goldPgMode){const timer=setInterval(persist,8000);timer.unref();}
function operatingSystem(ua=''){
 const s=String(ua).toLowerCase();
 if(/iphone|ipad|ipod/.test(s))return 'iOS';
 if(/android/.test(s))return 'Android';
 if(/macintosh|mac os x|darwin/.test(s))return 'macOS';
 if(/windows/.test(s))return 'Windows';
 if(/linux|x11/.test(s))return 'Linux';
 return 'Other/Unknown';
}
function osFromFilename(name=''){
 const s=String(name).toLowerCase();
 if(/darwin|macos|osx|\.dmg/.test(s))return 'macOS';
 if(/windows|win32|win64|\.exe|\.msi/.test(s))return 'Windows';
 if(/android|\.apk/.test(s))return 'Android';
 if(/ios|\.ipa/.test(s))return 'iOS';
 if(/linux|\.deb|\.rpm|appimage|\.sh/.test(s))return 'Linux';
 return 'Other/Unknown';
}
function architecture(name=''){
 const s=String(name).toLowerCase();
 if(/arm64|aarch64/.test(s))return 'arm64';
 if(/amd64|x64|x86_64/.test(s))return 'x64';
 if(/i386|x86/.test(s))return 'x86';
 return 'Unknown';
}
function versionOf(name=''){
 const found=String(name).match(/(?:\d+\.){2}\d+(?:[-_.]?rc[-_.]?\d+)?/i);
 return found?found[0].replaceAll('_','-'):'Unknown';
}
function inc(obj,key,n=1){obj[key]=(obj[key]||0)+n}
function sourceHost(v){
 try{const u=new URL(v);const host=u.hostname.toLowerCase();return /^[a-z0-9.-]{1,120}$/.test(host)?host:'unknown'}catch{return 'direct/unknown'}
}
function today(){return new Date().toISOString().slice(0,10)}
function prune(){
 const deadline=new Date(Date.now()-94*86400000).toISOString().slice(0,10);
 for(const key of Object.keys(days))if(key<deadline)delete days[key];
}
function record(type,attrs={}){
 if(goldPgMode)return saveGoldEvent(type,attrs);
 const day=today();let row=days[day];
 if(!row)row=days[day]={pageViews:0,downloads:0,downloadClicks:0,pages:{},os:{},referrers:{},downloadOS:{},downloadArchitecture:{},downloadVersions:{},downloadFiles:{},osTabs:{}};
 if(type==='page'){
  row.pageViews++;inc(row.pages,attrs.path);inc(row.os,attrs.os);inc(row.referrers,attrs.referrer);
 }else if(type==='download'){
  row.downloads++;inc(row.downloadOS,attrs.os);inc(row.downloadArchitecture,attrs.arch);
  inc(row.downloadVersions,attrs.version);inc(row.downloadFiles,attrs.file);
 }else if(type==='download-click'){
  // Clicks are intention only; do not inflate served file download OS/version.
  row.downloadClicks++;
  row.externalClickOS??={};row.externalClickArchitecture??={};row.externalClickVersions??={};
  inc(row.externalClickOS,attrs.os);inc(row.externalClickArchitecture,attrs.arch);inc(row.externalClickVersions,attrs.version);
 }
 else if(type==='tab'){inc(row.osTabs,attrs.os)}
 changed=true;if(Object.keys(days).length>95)prune();
}
const legitimateAgents=/bot|crawler|spider|facebookexternalhit|preview|uptime|curl|wget|postman|python-requests|google-inspection/i;
const eventRate=new Map();
export function installSiteAnalytics(app){
 app.use((req,res,next)=>{
  if(goldPgMode&&goldWriteFailure)return next(Error('gold_site_analytics_db_unavailable'));
  if(req.method!=='GET')return next();
  const route=req.path;
  if(!TRACKED.has(route)&&!/^\/downloads\/files\/[^/]{1,220}$/.test(route)&&route!=='/downloads/install.sh')return next();
  const ua=String(req.headers['user-agent']||'').slice(0,600);
  if(legitimateAgents.test(ua))return next();
  res.once('finish',()=>{
   if(res.statusCode<200||res.statusCode>=400)return;
   if(TRACKED.has(route)){
    const result=record('page',{path:route,os:operatingSystem(ua),referrer:sourceHost(req.headers.referer||'')});
    if(result instanceof Promise)void result.catch(error=>{goldWriteFailure=error;console.error('[gold-site-analytics]',error?.message||error)});
   }else{
    const file=route.split('/').pop();
    const result=record('download',{file:file.slice(0,180),os:osFromFilename(file),arch:architecture(file),version:versionOf(file)});
    if(result instanceof Promise)void result.catch(error=>{goldWriteFailure=error;console.error('[gold-site-analytics]',error?.message||error)});
   }
  });
  next();
 });
 // Client-reported UI tab / GitHub clicks, not verified file transfers.
 app.post('/site/interaction',async(req,res)=>{
  // Keep anonymous telemetry bounded; only short, whitelisted events are accepted.
  const now=Date.now(),key=String(req.ip||req.socket?.remoteAddress||'unknown');
  const prior=eventRate.get(key);
  const current=prior&&now-prior.started<60_000?prior:{started:now,count:0};
  current.count++;eventRate.set(key,current);
  if(eventRate.size>3000)for(const [address,v] of eventRate)if(now-v.started>=60_000)eventRate.delete(address);
  if(current.count>100)return res.sendStatus(429);
  const origin=String(req.headers.origin||'');
  const allowedOrigin=goldPgMode?String(process.env.LIGHT_REMOTE_PLUGIN_ORIGIN||''):'https://light-remote.thaiduy.digital';
  if(origin&&origin!==allowedOrigin)return res.sendStatus(403);
  const event=String(req.body?.event||'');
  if(event==='os_tab'){const os=String(req.body?.os||'');if(!['Linux','Windows','macOS','iOS','Android','Docker'].includes(os))return res.sendStatus(400);try{await record('tab',{os})}catch(error){goldWriteFailure=error;return res.sendStatus(503)}}
  else if(event==='download_click'){
   const file=String(req.body?.file||'').slice(0,180);
   if(!/^[\w.\-]{3,180}$/.test(file))return res.sendStatus(400);
   try{await record('download-click',{file,os:osFromFilename(file),arch:architecture(file),version:versionOf(file)})}catch(error){goldWriteFailure=error;return res.sendStatus(503)}
  }else return res.sendStatus(400);
  return res.status(204).end();
 });
}
export function siteAnalyticsSummary(daysBack=30){
 if(goldPgMode)return goldStore().summary(daysBack);
 const windowDays=Math.max(1,Math.min(90,Number(daysBack)||30));
 const since=new Date(Date.now()-(windowDays-1)*86400000).toISOString().slice(0,10);
 const chosen=Object.entries(days).filter(([date])=>date>=since).sort((a,b)=>a[0].localeCompare(b[0]));
 const sums={pageViews:0,downloads:0,downloadClicks:0,pages:{},os:{},referrers:{},downloadOS:{},downloadArchitecture:{},downloadVersions:{},downloadFiles:{},osTabs:{},externalClickOS:{},externalClickArchitecture:{},externalClickVersions:{}};
 for(const [_,row] of chosen)for(const [key,value] of Object.entries(sums)){
  if(typeof value==='number')sums[key]+=row[key]||0;
  else for(const [name,num] of Object.entries(row[key]||{}))inc(sums[key],name,num);
 }
 const top=object=>Object.entries(object).sort((a,b)=>b[1]-a[1]).slice(0,35).map(([name,count])=>({name,count}));
 return {ok:true,days:windowDays,from:since,to:today(),totals:{pageViews:sums.pageViews,downloadResponses:sums.downloads,externalClickEvents:sums.downloadClicks},
  series:chosen.map(([date,row])=>({date,pageViews:row.pageViews||0,downloadResponses:row.downloads||0})),
  pages:top(sums.pages),os:top(sums.os),referrers:top(sums.referrers),
  downloads:{os:top(sums.downloadOS),architecture:top(sums.downloadArchitecture),versions:top(sums.downloadVersions),files:top(sums.downloadFiles),tabs:top(sums.osTabs)},
  externalClicks:{os:top(sums.externalClickOS),architecture:top(sums.externalClickArchitecture),versions:top(sums.externalClickVersions)},
  methodology:'Server-side page response counts and download HTTP responses. GitHub clicks and OS-tab events are separate client-reported events. Counts begin only when tracking is enabled; no retroactive data, no stored raw IP addresses or unique visitor claims.'};
}
export async function flushSiteAnalytics(){
 if(goldPgMode){await Promise.allSettled([...goldWrites]);return;}
 persist();
}
