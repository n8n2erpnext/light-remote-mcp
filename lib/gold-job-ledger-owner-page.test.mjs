import test from 'node:test';
import assert from 'node:assert/strict';
import {GoldJobLedger} from './gold-job-ledger.mjs';

const make=(n=340)=>Array.from({length:n},(_,i)=>({
 accountId:'owner',deviceId:'device-'+String(i).padStart(5,'0'),
 jobId:'j-'+String(i).padStart(6,'0'),status:i%2?'ok':'error',
 agentId:'agent-'+i,sessionId:'s-'+i,exitCode:i%2?0:1,
 startedAt:new Date(1794000000000+Math.floor(i/2)*1000),
 finishedAt:new Date(1794000001000+Math.floor(i/2)*1000),
 script:'SECRET',stdout:'OUTPUT'
}));
function harness(records=make()){
 let calls=[],flushed=0;
 const pool={async query(sql,params){
   calls.push({sql,params});
   assert.match(sql,/account_id=\$1 AND device_id=ANY\(\$2::text\[\]\)/);
   assert.ok(!sql.includes('public_view'),'never fetch secrets from PostgreSQL');
   const [accountId,ids,anchor,afterMs,afterId,pageLimit]=params;
   const owned=new Set(ids);
   const all=records.filter(r=>r.accountId===accountId&&owned.has(r.deviceId)&&
     r.startedAt.getTime()<=anchor).sort((a,b)=>
     b.startedAt.getTime()-a.startedAt.getTime()||
     b.jobId.localeCompare(a.jobId,'en'));
   if(sql.includes('count(*)::bigint'))return {rows:[{total:String(all.length)}]};
   const after=afterMs==null?all:all.filter(r=>
     r.startedAt.getTime()<afterMs||
     (r.startedAt.getTime()===afterMs&&r.jobId<afterId));
   return {rows:after.slice(0,pageLimit)};
 }};
 const ledger=new GoldJobLedger({pool,redact:v=>v});
 ledger.flush=async()=>{flushed++};
 const read=(ids,after=null,limit=100)=>
   ledger.pageForOwner({accountId:'owner',deviceIds:ids,limit,anchorMs:1794050000000,after});
 return {ledger,read,calls,flushed:()=>flushed};
}
test('H2 PostgreSQL keyset walks 340 jobs without slicing Owner deviceIds at 250',async()=>{
 const records=make(),h=harness(records);
 const ids=records.map(r=>r.deviceId);
 let after=null,all=[],total=0;
 do{
   const page=await h.read(ids,after);
   total=page.total;all.push(...page.rows);
   if(!page.hasMore)break;
   const last=page.rows.at(-1);
   after={startedAtMs:last.startedAt,jobId:last.jobId};
 }while(true);
 assert.equal(total,340);assert.equal(all.length,340);
 assert.equal(new Set(all.map(x=>x.jobId)).size,340);
 assert.equal(h.flushed(),4);
 assert.ok(h.calls.every(x=>x.params[1].length===340),
   'all Owner devices must be present, including beyond 250');
 assert.ok(h.calls.every(x=>!x.sql.includes('LIMIT 200')));
 assert.ok(!JSON.stringify(all).includes('SECRET'));
 assert.ok(!JSON.stringify(all).includes('OUTPUT'));
 assert.ok(!JSON.stringify(all).includes('script'));
});
test('H2 paged query binds account and full verified device list, never returns foreign results',async()=>{
 const records=[...make(4),{...make(1)[0],accountId:'foreign',jobId:'foreign'}];
 const h=harness(records);
 const q=await h.read(['device-00000','device-00002']);
 assert.equal(q.total,2);
 assert.ok(q.rows.every(x=>['device-00000','device-00002'].includes(x.deviceId)));
 assert.ok(!JSON.stringify(q).includes('foreign'));
});
test('H2 10000 Owner devices keep full scope with 100-row IO budget',async()=>{
 const records=make(10000),h=harness(records);
 const result=await h.read(records.map(r=>r.deviceId));
 assert.equal(result.rows.length,100);
 assert.equal(result.total,10000);
 assert.equal(result.hasMore,true);
 assert.ok(h.calls.every(x=>x.params[1].length===10000));
 assert.equal(h.calls.find(x=>x.params.length===6)?.params[5],101);
});
test('H2 foreign device returned from malicious/malformed store is rejected',async()=>{
 const pool={query:async(sql)=>sql.includes('count(')?
   {rows:[{total:'1'}]}:{rows:[{jobId:'j-foreign',deviceId:'foreign',
    status:'ok',startedAt:new Date(100),finishedAt:null,exitCode:0}]}};
 const ledger=new GoldJobLedger({pool,redact:v=>v});
 await assert.rejects(ledger.pageForOwner({
  accountId:'owner',deviceIds:['device-00000'],anchorMs:1000
 }),/row_invalid/);
});
test('H2 invalid scope, bounded limit, anchor and cursor fail before issuing queries',async()=>{
 const h=harness();
 const base={accountId:'owner',deviceIds:['device-00000'],limit:100,anchorMs:1000};
 for(const v of [
  {...base,accountId:'foreign!'},
  {...base,deviceIds:['foreign!']},
  {...base,deviceIds:Array(20001).fill('device-00000')},
  {...base,limit:101},{...base,limit:0},
  {...base,anchorMs:-1},
  {...base,after:{startedAtMs:2000,jobId:'j-1'}},
  {...base,after:{startedAtMs:50,jobId:'bad!'}}
 ])await assert.rejects(h.ledger.pageForOwner(v));
 assert.equal(h.calls.length,0);
});
