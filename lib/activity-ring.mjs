export function restoreActivityRing({files=[],readText,now=Date.now(),maxAgeMs=60*60*1000,maxEvents=5000,maxBytes=8*1024*1024}={}){
  if(typeof readText!=='function')throw new TypeError('activity_ring_read_text_required');
  const cutoff=Number(now)-Math.max(1,Number(maxAgeMs)||1),seen=new Set(),ring=[];
  let ringBytes=0,sequence=0;
  for(const file of files){
    let text='';try{text=String(readText(file)||'');}catch{continue;}
    for(const line of text.split('\n')){
      if(!line)continue;
      let event;try{event=JSON.parse(line);}catch{continue;}
      const atMs=Date.parse(event?.at||event?.ts||0);if(!Number.isFinite(atMs)||atMs<cutoff)continue;
      const key=[event?.id??'',event?.at??event?.ts??'',event?.type??'',event?.jobId??'',event?.requestId??''].join('|');
      if(seen.has(key))continue;seen.add(key);
      const encoded=JSON.stringify(event),bytes=Buffer.byteLength(encoded);
      ring.push({event,bytes,atMs});ringBytes+=bytes;
      const id=Number(event?.id);if(Number.isSafeInteger(id)&&id>sequence)sequence=id;
    }
  }
  ring.sort((a,b)=>a.atMs-b.atMs||Number(a.event?.id||0)-Number(b.event?.id||0));
  const eventCap=Math.max(1,Number(maxEvents)||1),byteCap=Math.max(1,Number(maxBytes)||1);
  while(ring.length&&(ring.length>eventCap||ringBytes>byteCap||ring[0].atMs<cutoff)){const old=ring.shift();ringBytes-=old.bytes;}
  return{ring,ringBytes,sequence};
}
