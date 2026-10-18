import crypto from 'node:crypto';

const TRACKED=new Set(['/','/downloads','/support','/ai-guide','/privacy','/terms','/cookies']);
let days={},pool=null,redis=null,redisPrefix='';
const inflight=new Set();
export async function initializeSiteAnalytics(postgresPool,redisClient,prefix){
 if(!postgresPool||typeof postgresPool.query!=='function')throw Error('gold_site_analytics_pg_required');
 if(!redisClient||typeof redisClient.eval!=='function'||!/^lr:gold:[a-z0-9_-]+:$/.test(prefix||''))
  throw Error('gold_site_analytics_redis_required');
 pool=postgresPool;redis=redisClient;redisPrefix=prefix;
 await refreshSiteAnalytics();
}
export async function refreshSiteAnalytics(){
 if(!pool)throw Error('gold_site_analytics_not_initialized');
 const {rows}=await pool.query('SELECT day::text AS day,metrics FROM lr_site_analytics_daily WHERE day >= current_date - interval \'94 days\' ORDER BY day');
 days=Object.fromEntries(rows.map(row=>[row.day,row.metrics]));
 return days;
}

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
function applyMetric(row,type,attrs){
 if(type==='page'){
  row.pageViews=(row.pageViews||0)+1;row.pages??={};row.os??={};row.referrers??={};
  inc(row.pages,attrs.path);inc(row.os,attrs.os);inc(row.referrers,attrs.referrer);
 }else if(type==='download'){
  row.downloads=(row.downloads||0)+1;
  for(const field of ['downloadOS','downloadArchitecture','downloadVersions','downloadFiles'])row[field]??={};
  inc(row.downloadOS,attrs.os);inc(row.downloadArchitecture,attrs.arch);inc(row.downloadVersions,attrs.version);inc(row.downloadFiles,attrs.file);
 }else if(type==='download-click'){
  row.downloadClicks=(row.downloadClicks||0)+1;
  row.externalClickOS??={};row.externalClickArchitecture??={};row.externalClickVersions??={};
  inc(row.externalClickOS,attrs.os);inc(row.externalClickArchitecture,attrs.arch);inc(row.externalClickVersions,attrs.version);
 }else if(type==='tab'){row.osTabs??={};inc(row.osTabs,attrs.os)}
 return row;
}
async function persistMetric(type,attrs){
 if(!pool)throw Error('gold_site_analytics_not_initialized');
 const day=today(),client=await pool.connect();let begun=false;
 try{
  await client.query('BEGIN');begun=true;
  await client.query("INSERT INTO lr_site_analytics_daily(day,metrics) VALUES($1::date,'{}'::jsonb) ON CONFLICT(day) DO NOTHING",[day]);
  const locked=(await client.query('SELECT metrics FROM lr_site_analytics_daily WHERE day=$1::date FOR UPDATE',[day])).rows[0];
  const row=applyMetric(locked.metrics,type,attrs);
  await client.query('UPDATE lr_site_analytics_daily SET metrics=$2::jsonb,updated_at=now() WHERE day=$1::date',[day,JSON.stringify(row)]);
  await client.query('COMMIT');begun=false;
  days[day]=row;
  if(Object.keys(days).length>95)prune();
 }catch(error){if(begun)await client.query('ROLLBACK').catch(()=>{});throw error}
 finally{client.release()}
}
function record(type,attrs={}){
 const task=persistMetric(type,attrs);
 inflight.add(task);
 void task.catch(error=>console.error('[site-analytics-pg]',error?.message||error))
  .finally(()=>inflight.delete(task));
}
const legitimateAgents=/bot|crawler|spider|facebookexternalhit|preview|uptime|curl|wget|postman|python-requests|google-inspection/i;
export function installSiteAnalytics(app){
 app.use((req,res,next)=>{
  if(req.method!=='GET')return next();
  const route=req.path;
  if(!TRACKED.has(route)&&!/^\/downloads\/files\/[^/]{1,220}$/.test(route)&&route!=='/downloads/install.sh')return next();
  const ua=String(req.headers['user-agent']||'').slice(0,600);
  if(legitimateAgents.test(ua))return next();
  res.once('finish',()=>{
   if(res.statusCode<200||res.statusCode>=400)return;
   if(TRACKED.has(route)){
    record('page',{path:route,os:operatingSystem(ua),referrer:sourceHost(req.headers.referer||'')});
   }else{
    const file=route.split('/').pop();
    record('download',{file:file.slice(0,180),os:osFromFilename(file),arch:architecture(file),version:versionOf(file)});
   }
  });
  next();
 });
 // Client-reported UI tab / GitHub clicks, not verified file transfers.
 app.post('/site/interaction',async(req,res)=>{
  // Redis is the atomic cross-replica rate authority for ephemeral telemetry.
  const ip=String(req.ip||req.socket?.remoteAddress||'unknown');
  const hash=crypto.createHash('sha256').update(ip).digest('hex');
  let count;
  try{
   count=Number(await redis.eval(
    "local count=redis.call('INCR',KEYS[1]);if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return count",
    {keys:[redisPrefix+'site:interaction:'+hash],arguments:['60']}));
  }catch{return res.status(503).json({ok:false,error:'gold_redis_unavailable'})}
  if(!Number.isSafeInteger(count)||count<1)return res.sendStatus(503);
  if(count>100)return res.sendStatus(429);
  const origin=String(req.headers.origin||'');
  if(origin&&!/^https:\/\/light-remote\.thaiduy\.digital$/i.test(origin))return res.sendStatus(403);
  const event=String(req.body?.event||'');
  if(event==='os_tab'){const os=String(req.body?.os||'');if(!['Linux','Windows','macOS','iOS','Android','Docker'].includes(os))return res.sendStatus(400);record('tab',{os})}
  else if(event==='download_click'){
   const file=String(req.body?.file||'').slice(0,180);
   if(!/^[\w.\-]{3,180}$/.test(file))return res.sendStatus(400);
   record('download-click',{os:osFromFilename(file),arch:architecture(file),version:versionOf(file)});
  }else return res.sendStatus(400);
  return res.status(204).end();
 });
}
export function siteAnalyticsSummary(daysBack=30){
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
export async function flushSiteAnalytics(){await Promise.allSettled([...inflight])}
