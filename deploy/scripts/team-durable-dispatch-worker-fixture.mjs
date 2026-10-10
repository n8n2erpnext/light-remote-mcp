import {DurableTeamUatStore} from '../../operator-host/team-durable-dispatch-uat.mjs';
const [dbFile,clock,device,actor,operation,budget]=process.argv.slice(2);
const store=new DurableTeamUatStore({dbFile,now:()=>Number(clock),
 authorize:()=>true,budgetFor:()=>Number(budget),leaseMs:60000});
try{
 const result=store.claim({ownerAccountId:'paid-owner',actorAccountId:actor,
  agentId:'agent-'+actor,deviceId:device,operationId:operation,
  fingerprint:'a'.repeat(64),kind:'member'});
 process.stdout.write(JSON.stringify({ok:true,jobId:result.job.jobId,retry:result.retry})+'\n');
}catch(e){
 if(!['device_worker_slots_busy','member_budget_exhausted'].includes(e.message))throw e;
 process.stdout.write(JSON.stringify({ok:false,error:e.message})+'\n');
}finally{store.close();}
