import assert from 'node:assert/strict';
import {initializeSiteAnalytics,siteAnalyticsSummary} from '../../plugin-server/site-analytics.mjs';
const day=new Date().toISOString().slice(0,10);
const statements=[];
const pool={async query(sql){
 statements.push(sql);
 if(sql.includes('SELECT day::text AS day,page_views,downloads,download_clicks'))
  return {rows:[{day,page_views:'5',downloads:'2',download_clicks:'3'}]};
 if(sql.includes('SELECT day::text AS day,dimension,value,count'))
  return {rows:[{day,dimension:'pages',value:'/downloads',count:'5'},
    {day,dimension:'downloadOS',value:'Windows',count:'2'},
    {day,dimension:'externalClickOS',value:'macOS',count:'3'}]};
 throw Error('unexpected SQL '+sql);
}};
const redis={async eval(){return 1}};
await initializeSiteAnalytics(pool,redis,'lr:gold:synthetic:');
const summary=siteAnalyticsSummary(7);
assert.deepEqual(summary.totals,{pageViews:5,downloadResponses:2,externalClickEvents:3});
assert.deepEqual(summary.pages,[{name:'/downloads',count:5}]);
assert.deepEqual(summary.downloads.os,[{name:'Windows',count:2}]);
assert.deepEqual(summary.externalClicks.os,[{name:'macOS',count:3}]);
assert.ok(statements.every(q=>!q.includes('jsonb')&&!q.includes('metrics')));
console.log('GOLD_NATIVE_ANALYTICS_SQL_FAKE=PASS');
