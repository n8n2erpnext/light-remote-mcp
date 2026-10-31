// Emits the actual source SQL executed by Operator startup, not a
// hand-copied approximation. Used only in no-network disposable PG tests.
import {GoldJobLedger} from '../../lib/gold-job-ledger.mjs';
import {GoldPersonalAgentScheduler} from '../../lib/gold-personal-agent-scheduler.mjs';
const statements=[];
const pool={
 query:async sql=>{statements.push(sql);return {rows:[],rowCount:0}},
 connect:async()=>{throw Error('fixture_must_not_open_real_pool')}
};
await GoldJobLedger.open({pool,redact:x=>x,preserveGuestUnknown:true});
await new GoldPersonalAgentScheduler({
 pool,resources:{},preserveGuestReservations:true
}).recoverStartup();
if(statements.length!==2||statements.some(s=>!s.includes('lr_gold_pro_share_guest_jobs')))
 throw Error('guest_restart_actual_source_queries_missing');
process.stdout.write(statements.map(x=>x+';\n').join(''));
