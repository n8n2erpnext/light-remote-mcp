// Gold P2-I4C3c2 independent Guest process branch.
// Called ONLY after existing Gold execution-epoch checks. The command is
// authenticated as the enrolled owner Device channel, but that identity is
// NOT Guest permission: require a second short-lived, pinned-signer ticket.
// Disk journal must reserve before launch; any crash/unknown never retries.
import {verifyGoldGuestDeviceTicket} from '../lib/gold-pro-share-guest-device-ticket.mjs';
export class GoldGuestProcessLaneError extends Error{
 constructor(code,status=403){super(code);this.name='GoldGuestProcessLaneError';this.status=status}
}
const deny=why=>{throw new GoldGuestProcessLaneError(why)};
const ID=/^cmd_[a-f0-9-]{36}$/;
const PROCESS=/^lp_[A-Za-z0-9_-]{20,80}$/;
export async function executeGoldGuestDeviceProcess({
 command,state,env=process.env,executionEpochReady=false,
 readCommand,writeCommand,launchProcess,inferRequiredCapabilities,
 hardDeny,localDirectoryExists,now=Date.now
}={}){
 if(env.OPERATOR_AGENT_GUEST_PROTOCOL_V1!=='1'||
    !executionEpochReady)deny('guest_agent_protocol_and_epoch_required');
 if(!command||!ID.test(command.commandId||'')||
    !command.payload||Object.keys(command.payload).sort().join('|')!==
    'processIntent|ticketEnvelope|type'||
    command.payload.type!=='guest-process-v1')
  deny('guest_agent_payload_shape_denied');
 if([readCommand,writeCommand,launchProcess,
    inferRequiredCapabilities,hardDeny,localDirectoryExists]
   .some(f=>typeof f!=='function'))
  deny('guest_agent_trusted_executor_missing');
 const t=command.payload,prior=readCommand(command.commandId);
 if(prior){
  if(prior.state==='finished'&&prior.result)return prior.result;
  // Explicit UNKNOWN after crash, no second spawn, no claiming terminal.
  const result={status:'error',exitCode:125,stdout:'',
   stderr:'guest_execution_unknown_prior_reservation\n',
   durationMs:0,data:{ok:false,unknown:true,
    error:'guest_execution_unknown_prior_reservation'}};
  writeCommand(command.commandId,{...prior,state:'finished',
   result,finishedAt:now()});
  return result;
 }
 const verified=verifyGoldGuestDeviceTicket({
  envelope:t.ticketEnvelope,state,commandId:command.commandId,
  payload:t.processIntent,
  requiredCapabilities:t.ticketEnvelope.ticket.requiredCapabilities,
  inferRequiredCapabilities,hardDeny,now
 });
 if(!localDirectoryExists(verified.command.cwd))
  deny('guest_agent_cwd_local_denied');
 // Persist effect-intent BEFORE process start. If disk write fails we do
 // not spawn; if launch/ACK fails afterward, we cannot assume no side effect.
 const start=now();
 writeCommand(command.commandId,{
  commandId:command.commandId,operationId:verified.operationId,
  state:'running',startedAt:start,guestJobId:verified.jobId,
  guestPayloadSha256:verified.payloadSha256,
  ownerAccountId:verified.ownerAccountId,
  guestAccountId:verified.guestAccountId
 });
 try{
  const data=await launchProcess(Object.freeze({...verified,
   sessionId:'gshare_'+verified.jobId
  }));
  const processId=data?.process?.processId;
  if(!PROCESS.test(processId||''))
   deny('guest_agent_launch_unverified_process_handle');
  const result={status:'ok',exitCode:0,stdout:'',stderr:'',
   durationMs:Math.max(0,now()-start),
   data:{ok:true,operation:'start',process:data.process,
    guestLaunch:Object.freeze({
     purpose:'pro-share-guest',jobId:verified.jobId,
     ownerAccountId:verified.ownerAccountId,
     guestAccountId:verified.guestAccountId,
     agentId:verified.agentId,grantId:verified.grantId,
     connectionId:verified.connectionId,
     operationId:verified.operationId,
     permissionRevision:verified.ticket.permissionRevision,
     payloadSha256:verified.payloadSha256,
     commandId:command.commandId,processId
    })}
  };
  writeCommand(command.commandId,{commandId:command.commandId,
   operationId:verified.operationId,state:'finished',
   startedAt:start,finishedAt:now(),guestJobId:verified.jobId,
   guestPayloadSha256:verified.payloadSha256,result});
  return result;
 }catch(error){
  // This is ONLY a launch acknowledgement; not terminal proof.
  const result={status:'error',exitCode:125,stdout:'',
   stderr:'guest_launch_unknown_or_denied\n',
   durationMs:Math.max(0,now()-start),
   data:{ok:false,unknown:true,error:'guest_launch_unknown_or_denied'}};
  writeCommand(command.commandId,{commandId:command.commandId,
   operationId:verified.operationId,state:'finished',startedAt:start,
   finishedAt:now(),guestJobId:verified.jobId,
   guestPayloadSha256:verified.payloadSha256,result});
  return result;
 }
}
