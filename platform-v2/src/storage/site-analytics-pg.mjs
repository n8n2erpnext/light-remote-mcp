import crypto from 'node:crypto';

const ALLOWED=new Set(['page','download','download-click','tab']);
const clean=(v,max)=>String(v||'').slice(0,max);
const count=(map,key,n)=>{if(!key)return;map[key]=(map[key]||0)+n};
const initial=()=>({
 pageViews:0,downloads:0,downloadClicks:0,pages:{},os:{},referrers:{},
 downloadOS:{},downloadArchitecture:{},downloadVersions:{},downloadFiles:{},osTabs:{},
 externalClickOS:{},externalClickArchitecture:{},externalClickVersions:{}
});
const top=object=>Object.entries(object).sort((a,b)=>b[1]-a[1]).slice(0,35)
 .map(([name,count])=>({name,count}));

export class GoldPgSiteAnalyticsRepository{
 constructor({pool,now=()=>Date.now()}={}){
  if(!pool||typeof pool.query!=='function')throw Error('gold_site_analytics_pg_pool_required');
  this.pool=pool;this.now=now;
 }
 async record(type,attrs={}){
  if(!ALLOWED.has(type))throw Error('gold_analytics_event_invalid');
  const field={
   pagePath:type==='page'?clean(attrs.path,100):'',
   osName:clean(attrs.os,40),
   referrerHost:type==='page'?clean(attrs.referrer,120):'',
   downloadFile:type==='download'||type==='download-click'?clean(attrs.file,180):'',
   architecture:clean(attrs.arch,20),
   appVersion:clean(attrs.version,50)
  };
  if(type==='page'&&!field.pagePath)throw Error('gold_analytics_path_required');
  if(['download','download-click'].includes(type)&&!field.downloadFile)
   throw Error('gold_analytics_file_required');
  const sql=[
   'INSERT INTO lr_site_analytics_events',
   '(event_id,event_day,event_type,page_path,os_name,referrer_host,download_file,architecture,app_version)',
   'VALUES($1,CURRENT_DATE,$2,$3,$4,$5,$6,$7,$8)'
  ].join(' ');
  await this.pool.query(sql,[crypto.randomUUID(),type,field.pagePath,field.osName,
   field.referrerHost,field.downloadFile,field.architecture,field.appVersion]);
 }
 async summary(daysBack=30){
  const windowDays=Math.max(1,Math.min(90,Number(daysBack)||30));
  const query=[
   'SELECT event_day,event_type,page_path,os_name,referrer_host,download_file,architecture,app_version,',
   'COUNT(*)::integer AS events FROM lr_site_analytics_events',
   'WHERE event_day>=CURRENT_DATE-($1::integer-1)',
   'GROUP BY event_day,event_type,page_path,os_name,referrer_host,download_file,architecture,app_version',
   'ORDER BY event_day ASC'
  ].join(' ');
  const result=await this.pool.query(query,[windowDays]);
  const days=new Map();
  const totals=initial();
  for(const event of result.rows||[]){
   const day=event.event_day instanceof Date?event.event_day.toISOString().slice(0,10):String(event.event_day).slice(0,10);
   const n=Number(event.events);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isSafeInteger(n)||n<=0)
     throw Error('gold_analytics_invalid_row');
   let r=days.get(day);
   if(!r){r={pageViews:0,downloads:0};days.set(day,r)}
   const type=String(event.event_type);
   if(!ALLOWED.has(type))throw Error('gold_analytics_invalid_event_type');
   if(type==='page'){
    r.pageViews+=n;totals.pageViews+=n;
    count(totals.pages,event.page_path,n);
    count(totals.os,event.os_name,n);
    count(totals.referrers,event.referrer_host,n);
   }else if(type==='download'){
    r.downloads+=n;totals.downloads+=n;
    count(totals.downloadOS,event.os_name,n);
    count(totals.downloadArchitecture,event.architecture,n);
    count(totals.downloadVersions,event.app_version,n);
    count(totals.downloadFiles,event.download_file,n);
   }else if(type==='download-click'){
    totals.downloadClicks+=n;
    count(totals.externalClickOS,event.os_name,n);
    count(totals.externalClickArchitecture,event.architecture,n);
    count(totals.externalClickVersions,event.app_version,n);
   }else count(totals.osTabs,event.os_name,n);
  }
  const today=new Date(this.now()).toISOString().slice(0,10);
  const since=new Date(this.now()-(windowDays-1)*86400000).toISOString().slice(0,10);
  return {ok:true,days:windowDays,from:since,to:today,
   totals:{pageViews:totals.pageViews,downloadResponses:totals.downloads,externalClickEvents:totals.downloadClicks},
   series:[...days.entries()].sort(([a],[b])=>a.localeCompare(b))
     .map(([date,r])=>({date,pageViews:r.pageViews,downloadResponses:r.downloads})),
   pages:top(totals.pages),os:top(totals.os),referrers:top(totals.referrers),
   downloads:{os:top(totals.downloadOS),architecture:top(totals.downloadArchitecture),
    versions:top(totals.downloadVersions),files:top(totals.downloadFiles),tabs:top(totals.osTabs)},
   externalClicks:{os:top(totals.externalClickOS),architecture:top(totals.externalClickArchitecture),
    versions:top(totals.externalClickVersions)},
   methodology:'Server-side page response counts and download HTTP responses. GitHub clicks and OS-tab events are separate client-reported events. Counts begin only when tracking is enabled; no retroactive data, no stored raw IP addresses or unique visitor claims.'};
 }
}
