import {validateVideoPacket} from '../lib/rmv2-video.mjs';

// Pixel payloads never enter jobs, PostgreSQL, Redis, event history or logs.
// One latest frame per exact actor/task,2s TTL and a16MiB total RAM ceiling.
export class RmVideoRelay{
  constructor({now=Date.now,maxBytes=16*1024*1024,maxClosed=1024}={}){this.now=now;this.maxBytes=maxBytes;this.maxClosed=maxClosed;this.bytes=0;this.rows=new Map();this.closed=new Map();this.refusePushUntil=0;this.timer=setInterval(()=>this.prune(),500);this.timer.unref?.();}
  key(owner){return [owner.accountId,owner.deviceId,owner.sessionId,owner.agentId,owner.desktopSessionId].map(x=>{if(typeof x!=='string'||!x||x.length>160||x.includes('|'))throw Error('video_relay_owner_invalid');return x;}).join('|');}
  remove(key){const row=this.rows.get(key);if(row)this.bytes-=row.bytes;this.rows.delete(key);}
  prune(){const now=this.now();for(const [key,row] of this.rows)if(now-row.at>2000)this.remove(key);for(const [key,until] of this.closed)if(now>=until)this.closed.delete(key);}
  push(owner,packet){
    this.prune();const key=this.key(owner);
    if(this.closed.has(key)||this.now()<this.refusePushUntil)throw Error('video_relay_scope_closed');
    validateVideoPacket(packet.video);
    if(typeof packet.epoch!=='string'||!packet.epoch||packet.epoch.length>160)throw Error('video_relay_epoch_invalid');
    if(!Number.isSafeInteger(packet.frameSeq)||packet.frameSeq<1)throw Error('video_relay_sequence_invalid');
    const previous=this.rows.get(key);if(previous&&packet.epoch===previous.packet.epoch&&packet.frameSeq<=previous.packet.frameSeq)throw Error('video_relay_sequence_stale');
    const bytes=Buffer.byteLength(packet.video.data,'ascii')+4096;if(bytes>this.maxBytes)throw Error('video_relay_budget');
    this.remove(key);while(this.rows.size>=32||this.bytes+bytes>this.maxBytes)this.remove(this.rows.keys().next().value);
    // Copy validated scalar metadata/data; no arbitrary nesting/identity fields.
    const video=packet.video;const safe={frameSeq:packet.frameSeq,epoch:packet.epoch,desktopSessionId:owner.desktopSessionId,video:{mime:video.mime,format:video.format,codec:video.codec,keyFrame:true,width:video.width,height:video.height,timestampUs:video.timestampUs,fps:video.fps,capturedAt:video.capturedAt,encoderBackend:video.encoderBackend,hardwareEncoding:video.hardwareEncoding,gpuResize:video.gpuResize,dataBytes:video.dataBytes,data:video.data}};
    this.rows.set(key,{at:this.now(),bytes,packet:safe});this.bytes+=bytes;return {accepted:true,frameSeq:safe.frameSeq,ttlMs:2000,storage:'bounded-ram-only'};
  }
  read(owner,{includeData=false}={}){
    this.prune();const row=this.rows.get(this.key(owner));if(!row)throw Error('video_relay_no_recent_frame');
    const video={...row.packet.video};if(!includeData)delete video.data;
    return {...row.packet,video,ageMs:Math.max(0,this.now()-row.at),storage:'bounded-ram-only'};
  }
  close(owner){
    this.prune();const key=this.key(owner);this.remove(key);
    // A signed in-flight frame can arrive after close on another connection.
    // Keep only actor keys (no pixels), bounded and expiring; never resurrect
    // a closed scope by dropping its tombstone to admit another one.
    const until=this.now()+120000;
    if(this.closed.has(key)||this.closed.size<this.maxClosed)this.closed.set(key,until);
    else this.refusePushUntil=Math.max(this.refusePushUntil,until);
  }
  dispose(){clearInterval(this.timer);this.rows.clear();this.closed.clear();this.refusePushUntil=0;this.bytes=0;}
}
