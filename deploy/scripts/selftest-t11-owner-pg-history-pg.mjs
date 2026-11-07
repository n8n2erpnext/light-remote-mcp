// T11-F15-H2: actual PostgreSQL 17 keyset page integration in the ONLY
// disposable lr_gold_epoch_fixture_* DB provisioned by ci-gold-epoch-pg.
// Never run against Gold UAT or production; isolated fixture is destroyed by CI.
import assert from 'node:assert/strict';
import pg from 'pg';
import {performance} from 'node:perf_hooks';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
const db=process.env.LR_GOLD_EPOCH_TEST_DB||'';
assert.equal(process.env.LR_EPOCH_PG_TEST_ALLOW,'1','disposable epoch fixture required');
assert.equal(process.env.LR_T11_OWNER_H2_PG_ALLOW,'1','H2 explicit fixture opt-in required');
assert.match(db,/^lr_gold_epoch_fixture_[0-9]{8}$/,'refuse non-fixture database');
const pool=new pg.Pool({database:db,max:3,statement_timeout:15000,
 connectionTimeoutMillis:5000});
const accountId='owner_h2_fixture';
const ids=Array.from({length:10000},(_,i)=>'h2_device_'+String(i).padStart(5,'0'));
const anchorMs=1794000000000;
const times=[];
try{
 // The existing epoch fixture has a deliberately minimal job schema. Extend
 // ONLY that disposable fixture to cover the original production ledger schema.
 await pool.query(`ALTER TABLE lr_gold_job_records
   ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
   ADD COLUMN IF NOT EXISTS agent_id TEXT,
   ADD COLUMN IF NOT EXISTS session_id TEXT`);
 // Avoid replacing fixtures or modifying records belonging to other P1E tests.
 const exists=await pool.query(`SELECT count(*)::int AS n FROM lr_gold_job_records
   WHERE account_id=$1`,[accountId]);
 assert.equal(exists.rows[0].n,0);
 await pool.query(`INSERT INTO lr_gold_job_records
   (job_id,account_id,device_id,status,started_at,finished_at,
    agent_id,session_id,exit_code,public_view)
   SELECT 'h2_job_'||lpad(i::text,5,'0'),$1,
     'h2_device_'||lpad(i::text,5,'0'),'ok',
     to_timestamp(($2::double precision-i*1000)/1000),
     to_timestamp(($2::double precision-i*1000+500)/1000),
     'agent_h2','session_h2',0,
     '{"command":"DO_NOT_READ","token":"DO_NOT_FETCH"}'::jsonb
   FROM generate_series(0,339) AS i`,[accountId,anchorMs-1000]);
 await pool.query(`INSERT INTO lr_gold_job_records
   (job_id,account_id,device_id,status,started_at,public_view)
   VALUES ('h2_foreign_account','foreign_h2_account',$1,'ok',
     to_timestamp($2::double precision/1000),'{}'::jsonb),
    ('h2_foreign_device',$3,'h2_other_device','ok',
     to_timestamp($2::double precision/1000),'{}'::jsonb)`,
    [ids[0],anchorMs-1000,accountId]);
 const ledger=new GoldJobLedger({pool,redact:v=>v});
 let after=null,all=[],total=null;
 for(let p=0;p<5;p++){
  const started=performance.now();
  const page=await ledger.pageForOwner({accountId,deviceIds:ids,anchorMs,after,limit:100});
  times.push(performance.now()-started);
  assert.equal(page.total,340);
  assert.ok(page.rows.length<=100);
  assert.ok(page.rows.every(j=>ids.includes(j.deviceId)));
  assert.ok(!JSON.stringify(page.rows).includes('DO_NOT_READ'));
  all.push(...page.rows);
  total=page.total;
  if(!page.hasMore){assert.equal(page.rows.length,40);break;}
  after={startedAtMs:page.rows.at(-1).startedAt,jobId:page.rows.at(-1).jobId};
 }
 assert.equal(total,340);
 assert.equal(all.length,340);
 assert.equal(new Set(all.map(j=>j.jobId)).size,340);
 assert.ok(!JSON.stringify(all).includes('foreign'));
 // Re-read only live Owner device subset: removed device cannot be returned.
 const remaining=ids.filter(x=>x!=='h2_device_00000');
 const narrowed=await ledger.pageForOwner({
  accountId,deviceIds:remaining,anchorMs,limit:100});
 assert.equal(narrowed.total,339);
 const sorted=[...times].sort((a,b)=>a-b);
 const p95=sorted[Math.min(sorted.length-1,Math.ceil(.95*sorted.length)-1)];
 console.log('T11_F15_H2_REAL_POSTGRESQL_KEYSET_PASS '+JSON.stringify({
  deviceScope:ids.length,jobRows:all.length,pageSizes:[100,100,100,40],
  pageSamples:times.length,p95Ms:Math.round(p95*100)/100
 }));
}finally{await pool.end();}
