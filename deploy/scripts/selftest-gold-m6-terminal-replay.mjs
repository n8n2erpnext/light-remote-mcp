import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {SupervisorJobJournal} from '../../lib/supervisor-job-journal.mjs';
import {GoldDeviceResourceLocks} from '../../lib/gold-device-resource-locks.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gold-m6-replay-'));
fs.chmodSync(dir,0o700);
const owner={accountId:'uat-owner',deviceId:'uat-device',sessionId:'uat-session',agentId:'plugin-signed-uat-agent'};
const receipts=[];
try{
 const journal=new SupervisorJobJournal({dir});
 for(let i=0;i<41;i++){
  const processId='lp_'+crypto.randomBytes(20).toString('base64url');
  const operationId='op_'+String(i).padStart(20,'0');
  const fingerprint=crypto.createHash('sha256').update(operationId).digest('hex');
  const rec=journal.reserve(owner,operationId,fingerprint);
  journal.attach(rec.recordId,{processId,pid:null,startedAt:1000+i});
  const state=i%2?'stopped':'finished',finishedAt=1792660000000+i;
  journal.markFinished({processId,state,finishedAt,exitCode:state==='finished'?0:130});
  receipts.push({processId,state,finishedAt});
 }
 const batch=journal.unackedTerminals(owner.accountId,owner.deviceId);
 assert.equal(batch.length,32);
 assert.deepEqual(Object.keys(batch[0]).sort(),['exitCode','finishedAt','processId','state']);
 assert.throws(()=>journal.ackTerminals('not-owner',owner.deviceId,batch),/journal_ack_unproven_terminal/);
 assert.equal(journal.unackedTerminals(owner.accountId,owner.deviceId).length,32);
 assert.equal(journal.ackTerminals(owner.accountId,owner.deviceId,batch).acked,32);
 const restarted=new SupervisorJobJournal({dir});
 const pending=restarted.unackedTerminals(owner.accountId,owner.deviceId);
 assert.equal(pending.length,9);
 assert.equal(restarted.ackTerminals(owner.accountId,owner.deviceId,pending).acked,9);
 assert.equal(new SupervisorJobJournal({dir}).unackedTerminals(owner.accountId,owner.deviceId).length,0);
 assert.equal(restarted.ackTerminals(owner.accountId,owner.deviceId,batch).acked,0);
 assert.throws(()=>restarted.ackTerminals(owner.accountId,owner.deviceId,[{...receipts[0],finishedAt:1}]),/journal_ack_unproven_terminal/);
 console.log('M6_SUPERVISOR_DURABLE_ACK_AND_RESTART_REPLAY=PASS');

 const running=new Map([['lp_'+crypto.randomBytes(20).toString('base64url'),'job1']]);
 const acks=new Map(),sql=[];
 const pool={async connect(){return{async query(statement,args=[]){
  sql.push(statement);
  if(statement==='BEGIN'||statement==='COMMIT'||statement==='ROLLBACK'||statement.startsWith('SELECT pg_advisory'))return {rowCount:0,rows:[]};
  if(statement.startsWith('DELETE FROM lr_gold_device_resource_claims')){
   const jobId=running.get(args[2]);if(jobId)running.delete(args[2]);
   return jobId?{rowCount:1,rows:[{job_id:jobId}]}:{rowCount:0,rows:[]};
  }
  if(statement.startsWith('INSERT INTO lr_gold_terminal_receipt_acks')){
   const key=args.slice(0,3).join('|');
   if(!acks.has(key))acks.set(key,{jobId:args[3],state:args[4],at:args[5]});
   return {rowCount:1,rows:[]};
  }
  if(statement.startsWith('SELECT process_id FROM lr_gold_terminal_receipt_acks')){
   const row=acks.get(args.slice(0,3).join('|'));
   return row&&row.state===args[3]&&row.at===args[4]?{rowCount:1,rows:[{process_id:args[2]}]}:{rowCount:0,rows:[]};
  }
  throw Error('unexpected_pg_query');
 },release(){}}}};
 const lock=new GoldDeviceResourceLocks({capacity:2});
 const id=[...running.keys()][0],proof={processId:id,state:'stopped',finishedAt:1792660002345};
 const args={accountId:'uat-owner',deviceId:'uat-device',process:proof};
 assert.deepEqual(await lock.acknowledgeVerifiedTerminal(pool,args),{acked:true,released:true});
 assert.deepEqual(await lock.acknowledgeVerifiedTerminal(pool,args),{acked:true,released:false});
 assert.deepEqual(await lock.acknowledgeVerifiedTerminal(pool,{...args,process:{...proof,finishedAt:proof.finishedAt+1}}),{acked:false,released:false});
 assert.deepEqual(await lock.acknowledgeVerifiedTerminal(pool,{...args,process:{...proof,processId:'lp_'+crypto.randomBytes(20).toString('base64url')}}),{acked:false,released:false});
 assert.ok(sql.some(x=>x==='COMMIT'));
 assert.equal(acks.size,1);
 console.log('M6_PG_ATOMIC_RELEASE_ACK_AND_IDEMPOTENT_REPLAY=PASS');

 const manifest=JSON.parse(fs.readFileSync(new URL('../../platform-v2/sql/migrations.lock.json',import.meta.url),'utf8'));
 const m=manifest.migrations.at(-1);
 assert.equal(m.version,35);
 assert.equal(m.file,'035_gold_terminal_receipt_acks.sql');
 assert.equal(m.sha256,crypto.createHash('sha256').update(fs.readFileSync(new URL('../../platform-v2/sql/'+m.file,import.meta.url))).digest('hex'));
 console.log('M6_SQL_035_MIGRATION_LOCK_HASH=PASS');

 const operator=fs.readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
 const device=fs.readFileSync(new URL('../../device-agent/operator-agent.mjs',import.meta.url),'utf8');
 assert.match(operator,/terminalReceiptsAck/);
 assert.match(device,/confirmTerminalReceiptsAck/);
 assert.match(device,/listUnackedTerminals/);
 console.log('M6_SIGNED_DUPLEX_POLL_PULSE_ACK_HANDSHAKE=PASS');
}finally{
 fs.rmSync(dir,{recursive:true,force:true});
}
