// Real PostgreSQL38 restart lifecycle test, always rolled back.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
const req=createRequire(new URL('../../package.json',import.meta.url));
const {Client}=req('pg');
const file=process.env.LR_GOLD_PG_URL_FILE;
if(process.env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1'||!file)throw Error('isolated_gold_pg_environment_required');
const url=fs.readFileSync(file,'utf8').trim();
const db=new Client({connectionString:url});
await db.connect();
const uuid=crypto.randomUUID(), id2=crypto.randomUUID();
const pool={query:(...args)=>db.query(...args)};
let open=false;
try {
 await db.query('BEGIN');open=true;
 const ledger=new GoldJobLedger({pool,redact:v=>v});
 const base={accountId:'p0_restart_fixture_account',deviceId:'p0_restart_fixture_device',
 sessionId:'p0_restart_fixture_session',agentId:'p0_restart_fixture_agent',
 nodeId:'p0_restart_fixture_node',startedAt:Date.now(),remote:true,
 operationId:'p0_restart_fixture_'+uuid,operationFingerprint:'f'.repeat(64),
 requiredCapabilities:[]};
 const pending={...base,id:uuid,status:'running',finishedAt:null,exitCode:null};
 ledger.save(pending);await ledger.flush();
 assert.equal((await ledger.get(uuid))?.status,'running');
 const replayCommand='cmd_'+crypto.randomUUID();
 const done={...base,id:id2,status:'cancelled',finishedAt:Date.now(),exitCode:130,stopRequestedAt:Date.now(),commandId:replayCommand,signedResultVerified:true};
 ledger.save(done);await ledger.flush();
 assert.equal((await ledger.get(id2))?.status,'cancelled');
 const restored=await GoldJobLedger.open({pool,redact:v=>v});
 const unknown=await restored.get(uuid);
 assert.equal(unknown.status,'interrupted','a restart must not claim a live OS effect completed');
 assert.equal(unknown.effectState,'unknown','an interrupted effect needs unknown state');
 const terminal=await restored.get(id2);
 assert.equal(terminal.status,'cancelled','verified terminal must survive restart');
 assert.equal(terminal.exitCode,130);
 const mapped=await restored.completedForCommand({commandId:replayCommand,accountId:base.accountId,deviceId:base.deviceId,nodeId:base.nodeId});
 assert.equal(mapped?.jobId,id2,'durably committed terminal must map exact command after restart');
 assert.equal(mapped?.status,'cancelled');
 assert.equal(await restored.completedForCommand({commandId:replayCommand,accountId:'other-account',deviceId:base.deviceId,nodeId:base.nodeId}),null);
 const q=await db.query('SELECT status,finished_at FROM lr_gold_job_records WHERE job_id=$1',[uuid]);
 assert.equal(q.rows[0]?.status,'interrupted');
 assert.ok(q.rows[0]?.finished_at,'reconciliation records local transition without inventing signed completion');
 await db.query('ROLLBACK');open=false;
 const remaining=await db.query('SELECT count(*)::int AS n FROM lr_gold_job_records WHERE job_id = ANY($1::text[])',[[uuid,id2]]);
 assert.equal(remaining.rows[0].n,0,'fixture rows cannot leak into Gold history');
 console.log('P0_GOLD_REAL_PG38_RESTART_INTERRUPTED_NO_FALSE_TERMINAL_REPLAY_CANCELLED_ROLLBACK_PASS');
} finally {
 if(open)await db.query('ROLLBACK').catch(()=>{});
 await db.end();
}
