import {observationPacket,observationTicket} from '../lib/rmv2-observation.mjs';

// MCP image content is a separate typed block, not a base64 string inside text.
// The caller supplies already sanitized metadata and an exact authorized ticket.
export function appendObservationImage(formatted,packet,ticket){
 const safe=observationPacket(packet),actual=observationTicket(safe);
 for(const [key,value] of Object.entries(actual))if(ticket?.[key]!==value)throw Error('observation_image_ticket_mismatch');
 if(!safe.observation.image)throw Error('observation_image_missing');
 const image=safe.observation.image;
 return {...formatted,content:[...formatted.content,{type:'image',mimeType:image.mimeType,data:image.data}]};
}
export async function agentObservationRead(adapter,input,operationView){
 // Same operationId reconciles an unfinished job, not another capture request.
 const row=operationView(await adapter.desktop(input.sessionId,{op:'observe-read',desktopSessionId:input.desktopSessionId,observationId:input.observationId,afterSeq:input.afterSeq??0,waitMs:input.waitMs??1000},input.operationId,7000));
 const ticket=row?.data?.desktop?.imageTicket;
 if(!row.ok||row.job?.running||!ticket)return {view:row};
 const reply=await adapter.desktopObservationRead(input.sessionId,{desktopSessionId:input.desktopSessionId,...ticket});
 return {view:row,packet:reply.packet,ticket};
}
