import { memoryDigest, memoryOperationId } from '../lib/gold-memory-operation.mjs';
import { normalizeWorkerRequest, safeWorkerError, workerError, workerPilotEnabled, workerRef } from '../lib/api-worker-request.mjs';

export async function executeWorkerCommand({ state, command, modules, channel, allowed }) {
  let requestRef;
  let ok = false;
  try {
    requestRef = workerRef(command.requestRef);
    if (!workerPilotEnabled() || !modules || !allowed()) throw workerError('unavailable');
    const op = memoryOperationId(command.operationId);
    const who = { sessionId:command.sessionId, agentId:command.agentId };
    const ticket = { ...who, requestRef, requestDigest:command.requestDigest };
    const received = await channel('worker-content-fetch',ticket);
    const request = normalizeWorkerRequest(received.request);
    const actor = received.actor;
    if (received.operationId !== op || received.requestRef !== requestRef ||
        memoryDigest(request) !== command.requestDigest ||
        actor?.accountId !== state.enrollment?.accountId || actor?.deviceId !== state.enrollment?.deviceId ||
        actor?.sessionId !== who.sessionId || actor?.agentId !== who.agentId || !allowed()) {
      throw workerError('actor_invalid');
    }
    let reply;
    try {
      const authorize = async signal => {
        signal.throwIfAborted();
        if (!allowed()) return false;
        const response = await channel('worker-authorize',{ ...who, grantId:actor.grantId, connectionId:actor.connectionId });
        signal.throwIfAborted();
        return response.authorized === true && allowed();
      };
      reply = { ok:true, result:modules.remoteWorkerRequest(actor,request,authorize) };
    } catch (error) {
      reply = { ok:false, error:safeWorkerError(error) };
    }
    await channel('worker-content-push',{ ...ticket, reply });
    ok = reply.ok;
  } catch {
    // Content or an upstream diagnostic can never reach the command spool.
  }
  return { ok, worker:{ requestRef, phase:ok?'completed':'failed' } };
}
