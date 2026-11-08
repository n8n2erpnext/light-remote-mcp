import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UsageRegistry } from '../../operator-host/usage-registry.mjs';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-usage-')),stateFile=path.join(dir,'usage.json');
let now=Date.UTC(2026,8,12,12,0,0); const accountId='self-hosted-local',deviceId='dev_usage';
const u=new UsageRegistry({stateFile,now:()=>now});
const opened=Date.UTC(2026,7,31,23,30,0),closed=Date.UTC(2026,8,1,0,30,0);
const events=[
 {type:'session_activity',action:'toolCalls',accountId,deviceId,at:new Date(Date.UTC(2026,8,2)).toISOString()},
 {type:'session_activity',action:'toolCalls',accountId,deviceId,at:new Date(Date.UTC(2026,8,3)).toISOString()},
 {type:'device_connection_opened',accountId,deviceId,connectionId:'dc_test',hardExpiresAt:closed+3600000,at:new Date(opened).toISOString()},
 {type:'device_connection_closed',accountId,deviceId,connectionId:'dc_test',at:new Date(closed).toISOString()}
];
const b=u.backfill(events); if(!b.backfilled||b.events!==4)throw new Error('usage_backfill_failed');
const s=u.summary(accountId,{months:2}); if(s.toolCallsThisMonth!==2)throw new Error('usage_tool_calls_wrong');
const aug=s.series.find(x=>x.month==='2026-08'),sep=s.series.find(x=>x.month==='2026-09');
if(Math.abs(aug.onlineHours-0.5)>1e-9||Math.abs(sep.onlineHours-0.5)>1e-9)throw new Error('usage_month_split_wrong');
const reopened=new UsageRegistry({stateFile,now:()=>now}); reopened.reconcileConnections([{state:'connected',connectionId:'dc_live',accountId,deviceId,connectedAt:now-3600000,hardExpiresAt:now+3600000}]);
now+=30*60*1000; const live=reopened.summary(accountId,{months:1}); if(live.onlineHoursThisMonth<1.99||live.onlineHoursThisMonth>2.01)throw new Error('usage_live_accrual_wrong');
const again=reopened.backfill(events); if(again.backfilled)throw new Error('usage_backfill_must_be_one_time');
if(!fs.existsSync(stateFile)||JSON.parse(fs.readFileSync(stateFile,'utf8')).schemaVersion!==1)throw new Error('usage_persistence_failed');
console.log('v09-usage-backfill=PASS'); console.log('v09-usage-month-split=PASS'); console.log('v09-usage-live-accrual=PASS'); console.log('v09-usage-persistence=PASS');
fs.rmSync(dir,{recursive:true,force:true});
