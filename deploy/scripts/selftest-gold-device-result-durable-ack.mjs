import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../../operator-host/executor-routes-device-channel.mjs',import.meta.url),'utf8');
const begin=src.indexOf('  const acceptDeviceResult=async(');
const end=src.indexOf("    if (req.method === 'POST' && url.pathname === '/v1/enrollments/begin')",begin);
assert.ok(begin>0&&end>begin,'signed device result processor source boundaries');
const code=src.slice(begin,end);
function gate(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
const cmd={commandId:'cmd_123',jobId:'job_123',accountId:'account1',deviceId:'device1',nodeId:'node1'};
const ctx={binding:{accountId:'account1'},device:{deviceId:'device1',nodeId:'node1'}};
const result={commandId:'cmd_123',status:'cancelled',exitCode:130,stdout:'started',stderr:''};
function make({flush=gate(),owner='account1'}={}){
 const sequence=[],job={id:'job_123',commandId:'cmd_123',accountId:owner,deviceId:'device1',
   status:'running',finishedAt:null,stopRequestedAt:Date.now()};
 const commands=new Map([[cmd.commandId,cmd]]),jobs=new Map([[cmd.jobId,job]]);
 class FleetError extends Error { constructor(message,status){super(message);this.status=status;} }
 const scope={
  jobs,Buffer,MAX_MEMORY_OUTPUT:2**20,FleetError,
  applyDeviceTelemetry:()=>{},emitStream:()=>{},
  fleet:{command:id=>{if(!commands.has(id))throw Error('command_not_found');return commands.get(id);},
   complete:()=>{sequence.push('fleet.complete');}},
  goldJobs:{flush:()=>{sequence.push('ledger.flush');return flush.promise;}},
  finishJob:(j,exitCode)=>{sequence.push('finishJob');j.status='cancelled';j.exitCode=exitCode;j.finishedAt=Date.now();},
  jobView:j=>({status:j.status,exitCode:j.exitCode})
 };
 return {fn:vm.runInNewContext(code+';acceptDeviceResult',scope),sequence,flush,job};
}
{
 const x=make();let responded=false;
 const promise=x.fn(ctx,result,{resultTransport:'device-duplex-v1'}).then(v=>{responded=true;return v;});
 await new Promise(setImmediate);
 assert.equal(responded,false,'result ACK MUST await terminal PostgreSQL flush');
 assert.deepEqual(x.sequence,['finishJob','ledger.flush'],'Fleet command must remain in-flight before ledger commit');
 x.flush.resolve();const accepted=await promise;
 assert.equal(accepted.accepted,true);assert.equal(accepted.job.status,'cancelled');
 assert.equal(x.job.signedResultVerified,true,'verified Agent result must be persisted with terminal ledger');
 assert.deepEqual(x.sequence,['finishJob','ledger.flush','fleet.complete']);
}
{
 const x=make();const promise=x.fn(ctx,result,{resultTransport:'signed-poll-v1'});
 x.flush.reject(Error('PG_COMMIT_FAILED'));
 await assert.rejects(promise,/PG_COMMIT_FAILED/);
 assert.deepEqual(x.sequence,['finishJob','ledger.flush'],'no Fleet completion or signed ACK on failed commit');
}
{
 const x=make({owner:'other_account'});
 await assert.rejects(x.fn(ctx,result),/remote_job_not_found/);
 assert.deepEqual(x.sequence,[],'unowned job cannot mutate ledger or complete a Fleet command');
}
assert.match(src,/onResult:async\(authorized,result\)=>acceptDeviceResult/);
assert.match(src,/sendJson\(res,200,await acceptDeviceResult\(ctx,ctx\.payload/);
console.log('P0_GOLD_SIGNED_DEVICE_RESULT_PG_COMMIT_BEFORE_ACK_FLEET_COMPLETION_PASS');
