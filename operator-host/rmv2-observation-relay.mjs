import {observationPacket,observationTicket} from '../lib/rmv2-observation.mjs';
// Independent of the optional Owner video viewer. RAM only, exact read ticket.
export class RmObservationRelay{
 constructor({now=Date.now}={}){this.now=now;this.rows=new Map();this.closed=new Map();this.bytes=0;this.refuseUntil=0;this.timer=setInterval(()=>this.prune(),500);this.timer.unref?.();}
 key(owner){return [owner.accountId,owner.deviceId,owner.sessionId,owner.agentId,owner.desktopSessionId,owner.observationId].map(x=>{if(typeof x!=='string'||!x||x.length>160||x.includes('|'))throw Error('observation_actor_invalid');return x;}).join('|');}
 remove(key){const old=this.rows.get(key);if(old)this.bytes-=old.bytes;this.rows.delete(key);}
 prune(){for(const [k,v] of this.rows)if(this.now()-v.at>5000)this.remove(k);for(const [k,t] of this.closed)if(this.now()>=t)this.closed.delete(k);}
 push(owner,value){
  this.prune();const key=this.key(owner);if(this.closed.has(key)||this.now()<this.refuseUntil)throw Error('observation_scope_closed');
  const packet=observationPacket(value);if(!packet.observation.image||packet.observation.observationId!==owner.observationId)throw Error('observation_image_required');
  const previous=this.rows.get(key);if(previous&&(previous.packet.epoch!==packet.epoch||previous.packet.observation.observationEpoch!==packet.observation.observationEpoch||previous.packet.frameSeq>=packet.frameSeq))throw Error('observation_sequence_stale');
  const bytes=packet.observation.image.data.length+4096;this.remove(key);
  while(this.rows.size>=32||this.bytes+bytes>16*1024*1024)this.remove(this.rows.keys().next().value);
  this.rows.set(key,{packet,bytes,at:this.now()});this.bytes+=bytes;return {accepted:true,ttlMs:5000,storage:'bounded-ram-only'};
 }
 read(owner,ticket){
  this.prune();const row=this.rows.get(this.key(owner));if(!row)throw Error('observation_no_recent_image');
  for(const [k,v] of Object.entries(observationTicket(row.packet)))if(ticket[k]!==v)throw Error('observation_ticket_stale');
  return structuredClone(row.packet);
 }
 close(owner){this.prune();const key=this.key(owner);this.remove(key);if(this.closed.size<1024||this.closed.has(key))this.closed.set(key,this.now()+120000);else this.refuseUntil=this.now()+120000;}
 dispose(){clearInterval(this.timer);this.rows.clear();this.closed.clear();this.bytes=0;}
}
