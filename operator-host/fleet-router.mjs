import crypto from 'node:crypto';

export class FleetError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
function validId(value, name) {
  const v = String(value || '').trim();
  if (!ID_RE.test(v)) throw new FleetError(`invalid_${name}`);
  return v;
}
function cleanCapabilities(value) {
  const out=[];
  for (const raw of Array.isArray(value)?value:[]) {
    const item=String(raw||'').trim();
    if (/^[A-Za-z0-9._:-]{1,80}$/.test(item) && !out.includes(item) && out.length<64) out.push(item);
  }
  return out.sort();
}

export class FleetRouter {
  constructor({ now=()=>Date.now(), emit=()=>{}, channelTtlMs=20_000, commandLeaseMs=12_000, maxQueuedPerNode=64 }={}) {
    if (!Number.isFinite(channelTtlMs) || channelTtlMs < 5_000) throw new FleetError('invalid_channel_ttl');
    if (!Number.isFinite(commandLeaseMs) || commandLeaseMs < 2_000 || commandLeaseMs >= channelTtlMs) throw new FleetError('invalid_command_lease');
    this.now=now; this.emit=emit; this.channelTtlMs=Math.round(channelTtlMs); this.commandLeaseMs=Math.round(commandLeaseMs);
    this.maxQueuedPerNode=Math.max(1,Math.min(Number(maxQueuedPerNode)||64,1024));
    this.nodes=new Map(); this.commands=new Map(); this.completed=new Map(); this.waiters=new Map();
  }
  _state(node, now=this.now()) { return now-node.lastSeenAt<=this.channelTtlMs ? 'online':'offline'; }
  _view(node, now=this.now()) {
    return { accountId:node.accountId, deviceId:node.deviceId, nodeId:node.nodeId, state:this._state(node,now), draining:Boolean(node.agentDraining||node.ownerDraining),
      agentDraining:Boolean(node.agentDraining), ownerDraining:Boolean(node.ownerDraining), sessionCeiling:node.sessionCeiling,
      capabilities:[...node.capabilities], firstSeenAt:node.firstSeenAt, lastSeenAt:node.lastSeenAt,
      queuedCommands:node.queue.length, inFlightCommands:node.inFlight.size, channelTtlMs:this.channelTtlMs, commandLeaseMs:this.commandLeaseMs };
  }
  touch(input={}) {
    const accountId=validId(input.accountId,'account_id'), deviceId=validId(input.deviceId,'device_id'), nodeId=validId(input.nodeId,'node_id');
    const now=this.now(), prior=this.nodes.get(nodeId);
    if (prior && (prior.accountId!==accountId || prior.deviceId!==deviceId)) throw new FleetError('fleet_node_identity_conflict',409);
    const ceiling=Math.max(1,Math.min(Number(input.sessionCeiling)||2,100));
    const node=prior||{accountId,deviceId,nodeId,firstSeenAt:now,lastSeenAt:now,sessionCeiling:ceiling,capabilities:[],agentDraining:false,ownerDraining:false,queue:[],inFlight:new Map()};
    const wasOffline=prior ? this._state(prior,now)==='offline' : true;
    const drainBefore=Boolean(node.agentDraining||node.ownerDraining);
    node.lastSeenAt=now; node.sessionCeiling=ceiling; node.capabilities=cleanCapabilities(input.capabilities); node.agentDraining=Boolean(input.draining);
    this.nodes.set(nodeId,node);
    const drainAfter=Boolean(node.agentDraining||node.ownerDraining);
    if (!prior || wasOffline) this.emit({type:'node_channel_online',accountId,deviceId,nodeId,status:'online',sessionCeiling:ceiling});
    if (drainBefore!==drainAfter) this.emit({type:'node_drain_changed',accountId,deviceId,nodeId,status:drainAfter?'draining':'online',draining:drainAfter});
    return this._view(node,now);
  }
  node(nodeId) { const node=this.nodes.get(String(nodeId||'')); if(!node) throw new FleetError('target_node_channel_not_found',404); return node; }
  view(nodeId) { const node=this.node(nodeId); return this._view(node); }
  list() { return [...this.nodes.values()].map(n=>this._view(n)).sort((a,b)=>a.nodeId.localeCompare(b.nodeId)); }
  _notify(nodeId) {
    const set=this.waiters.get(String(nodeId||''));
    if(!set)return;
    for(const resolve of [...set])resolve();
    set.clear();
  }
  async waitPoll(input={}, waitMs=8_000) {
    let result=this.poll(input);
    if(result.state==='command' || result.node.draining || waitMs<=0)return result;
    const nodeId=result.node.nodeId, delay=Math.max(0,Math.min(Number(waitMs)||0,15_000));
    let set=this.waiters.get(nodeId);
    if(!set){set=new Set();this.waiters.set(nodeId,set);}
    let wake;
    const signal=new Promise(resolve=>{wake=resolve;set.add(resolve);});
    let timer;
    await Promise.race([signal,new Promise(resolve=>{timer=setTimeout(resolve,delay);})]);
    if(timer)clearTimeout(timer);
    set.delete(wake);
    if(!set.size)this.waiters.delete(nodeId);
    return this.poll(input);
  }
  setOwnerDrain(nodeId, draining=true) {
    const node=this.node(nodeId), before=Boolean(node.agentDraining||node.ownerDraining); node.ownerDraining=Boolean(draining); const after=Boolean(node.agentDraining||node.ownerDraining);
    if(before!==after)this.emit({type:'node_drain_changed',accountId:node.accountId,deviceId:node.deviceId,nodeId:node.nodeId,status:after?'draining':'online',draining:after});
    this._notify(node.nodeId);
    return this._view(node);
  }
  assertRoutable(nodeId,{accountId=null,deviceId=null}={}) {
    const node=this.node(nodeId); const view=this._view(node);
    if(accountId && node.accountId!==accountId) throw new FleetError('target_node_account_mismatch',403);
    if(deviceId && node.deviceId!==deviceId) throw new FleetError('target_node_device_mismatch',409);
    if(view.state!=='online') throw new FleetError('target_node_offline',409);
    if(view.draining) throw new FleetError('target_node_draining',409);
    return view;
  }
  enqueue(input={}) {
    const accountId=validId(input.accountId,'account_id'),deviceId=validId(input.deviceId,'device_id'),nodeId=validId(input.nodeId,'node_id'),jobId=validId(input.jobId,'job_id');
    const node=this.node(nodeId); this.assertRoutable(nodeId,{accountId,deviceId});
    if(node.queue.length+node.inFlight.size>=this.maxQueuedPerNode) throw new FleetError('target_node_queue_full',429);
    const commandId=input.commandId?validId(input.commandId,'command_id'):`cmd_${crypto.randomUUID()}`;
    if(this.commands.has(commandId)) throw new FleetError('command_already_exists',409);
    const command={commandId,jobId,accountId,deviceId,nodeId,payload:input.payload||{},createdAt:this.now(),dispatchedAt:null,attempts:0};
    this.commands.set(commandId,command); node.queue.push(commandId); this._notify(nodeId);
    this.emit({type:'node_command_queued',accountId,deviceId,nodeId,jobId,commandId,status:'queued'});
    return {...command};
  }
  poll(input={}) {
    const view=this.touch(input), node=this.node(view.nodeId), now=this.now();
    if(view.draining) return {node:view,state:'idle',command:null};
    let command=[...node.inFlight.values()].map(id=>this.commands.get(id)).find(c=>c && c.dispatchedAt+this.commandLeaseMs<=now);
    let redelivery=Boolean(command);
    if(!command) {
      while(node.queue.length && !command) { const id=node.queue.shift(), candidate=this.commands.get(id); if(candidate) command=candidate; }
      if(command) node.inFlight.set(command.commandId,command.commandId);
    }
    if(!command) return {node:this._view(node,now),state:'idle',command:null};
    command.dispatchedAt=now; command.attempts++;
    this.emit({type:redelivery?'node_command_redelivered':'node_command_dispatched',accountId:command.accountId,deviceId:command.deviceId,nodeId:command.nodeId,jobId:command.jobId,commandId:command.commandId,status:'running',attempts:command.attempts});
    return {node:this._view(node,now),state:'command',command:{...command}};
  }
  _pruneCompleted(now=this.now()) { for(const [id,row] of this.completed) if(row.expiresAt<=now)this.completed.delete(id); }
  command(commandId) {
    this._pruneCompleted();
    const command=this.commands.get(validId(commandId,'command_id'));
    if(!command) throw new FleetError('command_not_found',404);
    return {...command};
  }
  receipt(commandId) {
    this._pruneCompleted();
    const row=this.completed.get(validId(commandId,'command_id'));
    return row ? {...row.command,duplicate:true} : null;
  }
  abandon(commandId, reason='abandoned') {
    const command=this.commands.get(validId(commandId,'command_id'));
    if(!command) return null;
    const node=this.nodes.get(command.nodeId);
    if(node) { node.inFlight.delete(command.commandId); node.queue=node.queue.filter(id=>id!==command.commandId); }
    this.commands.delete(command.commandId);
    this.emit({type:'node_command_abandoned',accountId:command.accountId,deviceId:command.deviceId,nodeId:command.nodeId,jobId:command.jobId,commandId:command.commandId,status:'error',reason:String(reason||'abandoned').slice(0,80)});
    return {...command};
  }

  complete(input={}) {
    const commandId=validId(input.commandId,'command_id'), command=this.commands.get(commandId);
    if(!command) throw new FleetError('command_not_found',404);
    if(input.accountId && command.accountId!==input.accountId) throw new FleetError('command_account_mismatch',403);
    if(input.deviceId && command.deviceId!==input.deviceId) throw new FleetError('command_device_mismatch',403);
    if(input.nodeId && command.nodeId!==input.nodeId) throw new FleetError('command_node_mismatch',409);
    const node=this.node(command.nodeId); node.inFlight.delete(commandId); this.commands.delete(commandId);
    this.completed.set(commandId,{command:{...command},expiresAt:this.now()+Math.max(120_000,this.channelTtlMs*6)});
    this.emit({type:'node_command_completed',accountId:command.accountId,deviceId:command.deviceId,nodeId:command.nodeId,jobId:command.jobId,commandId,status:'completed'});
    return {...command,duplicate:false};
  }
}
