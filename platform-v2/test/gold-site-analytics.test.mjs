import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';

const work=fs.mkdtempSync(path.join(os.tmpdir(),'lr-gold-analytics-test-'));
process.env.LR_GOLD_SITE_ANALYTICS_PG='1';
process.env.LIGHT_REMOTE_SITE_ANALYTICS_PATH=path.join(work,'never-save-analytics.json');
process.env.LIGHT_REMOTE_PLUGIN_ORIGIN='http://127.0.0.1:5979';
const analytics=await import('../../plugin-server/site-analytics.mjs');
const {GoldPgSiteAnalyticsRepository}=await import('../src/storage/site-analytics-pg.mjs');
const events=[],statements=[];
let fail=false;
const pool={query:async(sql,params=[])=>{
 statements.push({sql,params});
 if(fail)throw Error('gold_pg_site_analytics_unavailable');
 if(sql.startsWith('INSERT INTO lr_site_analytics_events')){
  events.push(params);return{rows:[]};
 }
 if(sql.startsWith('SELECT event_day,event_type')){
  const day=new Date().toISOString().slice(0,10);
  const groups=new Map();
  for(const e of events){
   const [id,type,pagePath,osName,referrerHost,downloadFile,architecture,appVersion]=e;
   const key=JSON.stringify([type,pagePath,osName,referrerHost,downloadFile,architecture,appVersion]);
   const rec=groups.get(key)||{event_day:day,event_type:type,page_path:pagePath,
     os_name:osName,referrer_host:referrerHost,download_file:downloadFile,
     architecture,app_version:appVersion,events:0};
   rec.events++;groups.set(key,rec);
  }
  return{rows:[...groups.values()]};
 }
 throw Error('unexpected_sql:'+sql);
}};
const repo=new GoldPgSiteAnalyticsRepository({pool});
analytics.configureGoldPgSiteAnalytics(repo);
const app={
 middleware:null,interaction:null,
 use(handler){this.middleware=handler},
 post(route,handler){assert.equal(route,'/site/interaction');this.interaction=handler}
};
analytics.installSiteAnalytics(app);
const fakeResponse=()=>({
 code:null,status(c){this.code=c;return this},
 end(){return this},sendStatus(c){this.code=c;return this}
});
test('Gold site analytics writes structured events and reports existing Admin shape',async()=>{
 await repo.record('page',{path:'/downloads',os:'Windows',referrer:'example.org'});
 await repo.record('page',{path:'/downloads',os:'Windows',referrer:'example.org'});
 await repo.record('download',{file:'LightRemote-win-x64.exe',os:'Windows',arch:'x64',version:'0.9.0-rc.50'});
 await repo.record('download-click',{file:'LightRemote-win-x64.exe',os:'Windows',arch:'x64',version:'0.9.0-rc.50'});
 await repo.record('tab',{os:'Linux'});
 const data=await analytics.siteAnalyticsSummary(30);
 assert.equal(data.ok,true);
 assert.deepEqual(data.totals,{pageViews:2,downloadResponses:1,externalClickEvents:1});
 assert.deepEqual(data.pages[0],{name:'/downloads',count:2});
 assert.deepEqual(data.downloads.os[0],{name:'Windows',count:1});
 assert.deepEqual(data.downloads.tabs[0],{name:'Linux',count:1});
 assert.deepEqual(data.externalClicks.os[0],{name:'Windows',count:1});
 assert.equal(data.series.length,1);
 assert.equal(events.length,5);
 assert(events.every(e=>e[0].length===36&&e.every(v=>!String(v).includes('192.168'))));
 assert(statements.some(x=>x.sql.includes('COUNT(*)::integer AS events')));
 assert(statements.some(x=>x.sql.includes('GROUP BY event_day')));
 assert(!fs.existsSync(process.env.LIGHT_REMOTE_SITE_ANALYTICS_PATH));
});
test('Gold analytics event middleware waits for UI event commit; response view events are flushed',async()=>{
 const view=new EventEmitter();Object.assign(view,{statusCode:200});
 let passed=false;
 app.middleware({method:'GET',path:'/downloads',headers:{
   'user-agent':'Mozilla/5.0 Windows NT 10.0',referer:'https://example.org/abc'
 }},view,()=>passed=true);
 assert.equal(passed,true);
 view.emit('finish');
 await analytics.flushSiteAnalytics();
 const data=await repo.summary(30);
 assert.equal(data.totals.pageViews,3);
 const res=fakeResponse();
 await app.interaction({
  ip:'10.123.23.9',headers:{origin:'http://127.0.0.1:5979'},body:{event:'download_click',file:'LightRemote-win-x64.exe'}
 },res);
 assert.equal(res.code,204);
 const forbidden=fakeResponse();
 await app.interaction({ip:'203.0.113.9',headers:{origin:'https://evil.example'},body:{event:'os_tab',os:'Linux'}},forbidden);
 assert.equal(forbidden.code,403);
 assert.equal(events.length,7);
 assert(events.every(e=>!e.includes('10.123.23.9')),'raw IP must never be stored');
});
test('Gold analytics fails closed when PostgreSQL writes or summary fails',async()=>{
 fail=true;
 await assert.rejects(()=>analytics.siteAnalyticsSummary(30),/gold_pg_site_analytics_unavailable/);
 const res=fakeResponse();
 await app.interaction({ip:'198.51.100.2',headers:{},body:{event:'os_tab',os:'Linux'}},res);
 assert.equal(res.code,503);
 let forwarded;
 app.middleware({method:'GET',path:'/',headers:{}},{},e=>forwarded=e);
 assert.match(String(forwarded?.message),/gold_site_analytics_db_unavailable/);
 fail=false;
 assert(!fs.existsSync(process.env.LIGHT_REMOTE_SITE_ANALYTICS_PATH));
 fs.rmSync(work,{recursive:true,force:true});
});
