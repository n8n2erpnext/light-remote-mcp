import { apiPath } from '../lib/api-contract.mjs';
import { normalizeWorkerRequest, workerActorKey, workerError, workerRef } from '../lib/api-worker-request.mjs';
import { authorizeWorkerReview } from './rmv2-work-authority.mjs';
import { GoldMemoryContentRelay } from './gold-memory-content-relay.mjs';
import { startDeviceContentOperation } from './gold-memory-operation.mjs';

export function createWorkerRelay() {
  return new GoldMemoryContentRelay({ prefix:'wrk_', normalize:normalizeWorkerRequest,
    actorKey:workerActorKey, readRef:workerRef });
}

function currentActor(ctx, deps) {
  const { grantId, connectionId } = authorizeWorkerReview(ctx,deps);
  const actor = { accountId:ctx.binding.accountId, deviceId:ctx.device.deviceId,
    sessionId:ctx.payload.sessionId, agentId:ctx.payload.agentId, grantId, connectionId };
  workerActorKey(actor);
  return actor;
}

export async function workerOperation(req, res, deps) {
  const { payload, requestId } = deps.decryptEnvelope(await deps.readJson(req));
  if (payload.action !== 'worker') throw workerError('request_invalid');
  const session = deps.sessions.ensure(payload.sessionId,{agentId:payload.agentId});
  if (session.accountId !== payload.accountId || session.nodeId !== payload.nodeId) {
    throw workerError('actor_invalid');
  }
  const context = { payload, device:{deviceId:session.deviceId}, binding:{accountId:session.accountId} };
  const owner = currentActor(context,deps);
  const request = normalizeWorkerRequest(payload.worker);
  const job = await startDeviceContentOperation(payload,requestId,deps,{ session, owner, request,
    family:'worker',relay:deps.workerContent,label:'API Worker' });
  await deps.waitForJob(job,7000);
  if (workerActorKey(currentActor(context,deps)) !== workerActorKey(owner)) throw workerError('authority_lost');
  let reply;
  try {
    reply = deps.workerContent.read(owner,job.resultData?.worker?.requestRef);
  } catch {
    reply = {ok:false,error:'api_worker_receipt_unavailable'};
  }
  res.setHeader('Cache-Control','no-store');
  if (reply.pending) return deps.sendJson(res,200,{ok:true,pending:true,workerId:request.workerId,
    nextAction:'Poll status with the same workerId'});
  return deps.sendJson(res,200,{...reply,workerId:request.workerId});
}

export const workerChannelActions = new Map([
  [apiPath('workerContentFetchInternal'),'worker-content-fetch'],
  [apiPath('workerContentPushInternal'),'worker-content-push'],
  [apiPath('workerAuthorizeInternal'),'worker-authorize']
]);

export async function workerChannel(req,res,action,deps) {
  const ctx = await deps.verifiedChannelContext(await deps.readJson(req),action);
  const actor = currentActor(ctx,deps);
  const input = ctx.payload;
  res.setHeader('Cache-Control','no-store');
  if (action === 'worker-authorize') {
    if (input.grantId !== actor.grantId || input.connectionId !== actor.connectionId) {
      throw workerError('authority_lost');
    }
    return deps.sendJson(res,200,{ok:true,authorized:true});
  }
  if (action === 'worker-content-fetch') return deps.sendJson(res,200,{ok:true,actor,
    ...deps.workerContent.fetch(actor,input.requestRef,input.requestDigest)});
  return deps.sendJson(res,200,{ok:true,...deps.workerContent.push(actor,input.requestRef,input.reply)});
}

export function workerControlResult(result, requestRef) {
  if (result?.worker?.requestRef !== requestRef) throw workerError('ref_invalid');
  const ok = result?.ok === true;
  return {ok,worker:{requestRef:workerRef(requestRef),phase:ok?'completed':'failed'}};
}
