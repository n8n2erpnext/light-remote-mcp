import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {observationOptions,observationPacket,observationMetadata,observationTicket} from './rmv2-observation.mjs';
import {runObservation} from './rmv2-observation-agent.mjs';
import {RmObservationRelay} from '../operator-host/rmv2-observation-relay.mjs';
import {appendObservationImage,agentObservationRead} from '../plugin-server/rmv2-observation-image.mjs';
const obs='obs_'+'a'.repeat(32),epoch='oepoch_'+'b'.repeat(32),desk='desk_abcdefgh';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6vWQAAAAASUVORK5CYII=','base64');
function packet(){return {epoch:'vepoch_native',frameSeq:1,displayTopologyId:'topology',observation:{observationId:obs,observationEpoch:epoch,sourceSeq:1,state:'changed',profile:'precision',sourceBackend:'dxgi-d3d11',gpuCapture:true,lossless:true,resampled:false,width:1,height:1,sourceValidationAgeMs:2,physicalBounds:{x:-400,y:0,width:1,height:1},image:{mimeType:'image/png',data:png.toString('base64'),dataBytes:png.length,sha256:crypto.createHash('sha256').update(png).digest('hex')}}};}
const owner={accountId:'account',deviceId:'device',sessionId:'session',agentId:'agent',desktopSessionId:desk,observationId:obs};
test('precision ROI is explicit physical1:1 and overview stays optional',()=>{
 assert.throws(()=>observationOptions({desktopSessionId:desk},'observe-start'),/precision_region/);
 assert.throws(()=>observationOptions({desktopSessionId:desk,region:{x:0,y:0,width:385,height:10}},'observe-start'),/max384/);
 assert.equal(observationOptions({desktopSessionId:desk,profile:'overview'},'observe-start').fps,15);
 assert.equal(observationOptions({desktopSessionId:desk,observationId:obs,afterSeq:1},'observe-read').waitMs,1000);
 assert.throws(()=>observationOptions({desktopSessionId:desk,observationId:obs,waitMs:1501},'observe-read'),/invalid/);
});
test('image integrity, dimensions, geometry and lossless declarations fail closed',()=>{
 assert.equal(observationPacket(packet()).observation.image.data,png.toString('base64'));
 for(const mutate of [p=>p.observation.image.sha256='f'.repeat(64),p=>p.observation.width=2,p=>p.observation.resampled=true,p=>p.observation.gpuCapture=false,p=>p.observation.image.data+='A',p=>p.observation.sourceSeq=-1]){const p=packet();mutate(p);assert.throws(()=>observationPacket(p));}
 const p=packet();p.observation.image=null;assert.throws(()=>observationPacket(p),/missing/);p.observation.state='no_change';assert.equal(observationPacket(p).observation.image,null);
});
test('exact actor/ticket/epoch RAM relay expires, bounds memory and rejects late close races',()=>{
 let now=100;const relay=new RmObservationRelay({now:()=>now});try{
 const p=packet();relay.push(owner,p);assert.deepEqual(relay.read(owner,observationTicket(p)),observationPacket(p));
 assert.throws(()=>relay.read({...owner,agentId:'foreign'},observationTicket(p)),/no_recent/);
 assert.throws(()=>relay.read(owner,{...observationTicket(p),sourceSeq:2}),/ticket/);
 assert.throws(()=>relay.push(owner,p),/stale/);
 now+=5001;assert.throws(()=>relay.read(owner,observationTicket(p)),/no_recent/);assert.equal(relay.bytes,0);
 relay.close(owner);assert.throws(()=>relay.push(owner,{...p,frameSeq:2}),/scope_closed/);
 }finally{relay.dispose();}
});
test('MCP gets a real typed image; text/job metadata never carries encoded pixels',async()=>{
 const p=packet(),ticket=observationTicket(p);const view={ok:true,data:{desktop:{...observationMetadata(p),imageTicket:ticket}},job:{running:false}};
 const adapter={desktop:async()=>view,desktopObservationRead:async()=>({packet:p})};
 const value=await agentObservationRead(adapter,{sessionId:'session',desktopSessionId:desk,observationId:obs,operationId:'same-operation-id-1'},x=>x);
 const output=appendObservationImage({content:[{type:'text',text:JSON.stringify(value.view)}],structuredContent:view},value.packet,value.ticket);
 assert.equal(output.content[1].type,'image');assert.equal(output.content[1].mimeType,'image/png');assert.equal(output.content[1].data,png.toString('base64'));
 assert.ok(!output.content[0].text.includes(png.toString('base64')));assert.throws(()=>appendObservationImage(output,p,{...ticket,frameSeq:2}),/ticket/);
 let read=false;const pending=await agentObservationRead({...adapter,desktop:async()=>({...view,job:{running:true}}),desktopObservationRead:async()=>{read=true;}},{},x=>x);assert.equal(read,false);assert.equal(pending.packet,undefined);
});
test('Agent only reads cached producer, strips pixels from receipts, preserves coordinate freshness and denies owner mismatch',async()=>{
 const row={...owner,visualSessionId:'vis_native',leaseToken:'secret',nativeEpoch:'vepoch_native',displayTopologyId:'topology',observationId:obs,expiresAt:Date.now()+45000};let sent;
 const deps={requestNative:async(op)=>{assert.equal(op,'observation-read');return packet();},isCurrent:()=>true,send:async p=>{sent=p;},mono:()=>1000};
 const request={op:'observe-read',desktopSessionId:desk,observationId:obs};const result=await runObservation(row,owner,request,deps);
 assert.equal(sent.observation.image.data,png.toString('base64'));assert.ok(!JSON.stringify(result).includes(png.toString('base64')));assert.equal(row.lastFrameMap.bounds.x,-400);assert.equal(row.lastFrameMap.capturedMono,998);
 await assert.rejects(runObservation(row,{...owner,agentId:'foreign'},request,deps),/scope/);
 await assert.rejects(runObservation({...row,closing:true},owner,request,deps),/scope/);
 await assert.rejects(runObservation(row,owner,request,{...deps,requestNative:async()=>{row.closing=true;return packet();}}),/scope/);
});
