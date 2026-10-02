import { StringDecoder } from 'node:string_decoder';

export const DEVICE_DUPLEX_PROTOCOL='light-remote-duplex-v1';
export const DEVICE_DUPLEX_SERVER_EPOCH=`${Date.now().toString(36)}-${process.pid.toString(36)}`;

export class DeviceDuplexError extends Error{
  constructor(message,status=400){super(message);this.status=status;}
}

export function createNdjsonReader(stream,{maxFrameBytes=20*1024*1024,maxQueuedFrames=256}={}){
  const decoder=new StringDecoder('utf8'),queue=[],waiters=[];
  let buffer='',ended=false,failure=null;
  const settle=()=>{
    while(waiters.length&&(queue.length||ended||failure)){
      const waiter=waiters.shift();
      if(failure)waiter.reject(failure);
      else if(queue.length)waiter.resolve(queue.shift());
      else waiter.resolve(null);
    }
  };
  const fail=error=>{
    if(failure)return;
    failure=error instanceof Error?error:new DeviceDuplexError(String(error||'duplex_stream_error'),400);
    settle();
  };
  const pushLine=line=>{
    const text=String(line||'').trim();
    if(!text)return;
    let frame;
    try{frame=JSON.parse(text);}catch{throw new DeviceDuplexError('invalid_duplex_json',400);}
    if(!frame||typeof frame!=='object'||Array.isArray(frame))throw new DeviceDuplexError('invalid_duplex_frame',400);
    if(queue.length>=maxQueuedFrames)throw new DeviceDuplexError('duplex_inbound_queue_full',429);
    queue.push(frame);settle();
  };
  stream.on('data',chunk=>{
    if(failure||ended)return;
    try{
      buffer+=decoder.write(chunk);
      if(Buffer.byteLength(buffer)>maxFrameBytes)throw new DeviceDuplexError('duplex_frame_too_large',413);
      for(;;){
        const at=buffer.indexOf('\n');
        if(at<0)break;
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);pushLine(line);
      }
    }catch(error){fail(error);try{stream.destroy(error);}catch{}}
  });
  stream.on('end',()=>{
    if(ended)return;
    try{buffer+=decoder.end();if(buffer.trim())pushLine(buffer);}catch(error){fail(error);}
    buffer='';ended=true;settle();
  });
  stream.on('aborted',()=>{ended=true;fail(new DeviceDuplexError('duplex_request_aborted',499));});
  stream.on('error',fail);
  stream.on('close',()=>{ended=true;settle();});
  return {
    next(){if(failure)return Promise.reject(failure);if(queue.length)return Promise.resolve(queue.shift());if(ended)return Promise.resolve(null);return new Promise((resolve,reject)=>waiters.push({resolve,reject}));},
    get queued(){return queue.length;},
    get ended(){return ended;}
  };
}

export function createNdjsonWriter(stream,{maxPendingBytes=4*1024*1024,maxFrameBytes=2*1024*1024}={}){
  let tail=Promise.resolve(),pendingBytes=0,closed=false,frames=0;
  const writeChunk=data=>new Promise((resolve,reject)=>{
    if(closed||stream.destroyed||stream.writableEnded)return reject(new DeviceDuplexError('duplex_writer_closed',499));
    const onError=error=>{cleanup();reject(error);},onDrain=()=>{cleanup();resolve();};
    const cleanup=()=>{stream.off('error',onError);stream.off('drain',onDrain);};
    stream.once('error',onError);
    let accepted=false;
    try{accepted=stream.write(data);}catch(error){cleanup();reject(error);return;}
    if(accepted){cleanup();resolve();}else stream.once('drain',onDrain);
  });
  return {
    send(frame){
      if(closed)return Promise.reject(new DeviceDuplexError('duplex_writer_closed',499));
      const data=Buffer.from(JSON.stringify(frame)+'\n','utf8');
      if(data.length>maxFrameBytes)return Promise.reject(new DeviceDuplexError('duplex_outbound_frame_too_large',413));
      if(pendingBytes+data.length>maxPendingBytes)return Promise.reject(new DeviceDuplexError('duplex_outbound_backpressure',429));
      pendingBytes+=data.length;frames++;
      const run=async()=>{try{await writeChunk(data);}finally{pendingBytes=Math.max(0,pendingBytes-data.length);}};
      const next=tail.then(run,run);
      tail=next.catch(()=>{});
      return next;
    },
    close(){closed=true;try{stream.end();}catch{}},
    get pendingBytes(){return pendingBytes;},
    get frames(){return frames;},
    get closed(){return closed;}
  };
}
