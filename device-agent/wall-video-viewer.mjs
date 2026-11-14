import {WALL_FONT_FACE_CSS,WALL_UI_FONT} from '../lib/web-typography.mjs';

export function wallVideoPage({brandSvg='',latestPath,scriptPath}){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote · Live video</title><style>${WALL_FONT_FACE_CSS}
*{box-sizing:border-box}body{margin:0;background:#f5f7fb;color:#192c49;font-family:${WALL_UI_FONT};padding:32px}header,main{max-width:1280px;margin:auto}header{display:flex;align-items:center;gap:16px;margin-bottom:28px}header svg{width:40px;height:40px}h1{font-size:28px;margin:0}header a{margin-left:auto;color:#245e9c}main{background:white;border:1px solid #dfe6ee;border-radius:20px;padding:24px}p{color:#64748b;line-height:1.6}select,button{font:inherit;padding:10px 14px;border:1px solid #dfe6ee;border-radius:10px;background:white;color:inherit}select{max-width:100%}.bar{display:flex;gap:16px;align-items:center;flex-wrap:wrap}#stage{margin-top:20px;min-height:260px;background:#101820;border-radius:12px;display:grid;place-items:center;overflow:hidden}canvas{max-width:100%;height:auto;display:block}#empty{padding:32px;color:#d6e3ef;text-align:center}details{margin-top:20px}#metrics{font-size:14px;white-space:pre-wrap}#status{margin-left:auto}.dot{width:8px;height:8px;display:inline-block;background:#277eaf;border-radius:50%;margin-right:6px}@media(max-width:600px){body{padding:16px}main{padding:16px}h1{font-size:23px}}
</style></head><body data-latest-path="${latestPath}"><header>${brandSvg}<h1>Live video</h1><a href="/">Back to Wall</a></header><main><div class="bar"><select id="stream" aria-label="AI video session"><option value="">Waiting for video</option></select><button id="pause">Pause view</button><span id="status" role="status">Waiting for AI video</span></div><p>See the desktop frames your AI is viewing. Opening this page does not start control or keep an AI session open.</p><div id="stage"><canvas id="screen" hidden></canvas><div id="empty">No AI video right now.<br>Video appears when an authorized AI requests the advanced video view.</div></div><details><summary>Video details</summary><p id="metrics">No recent frames</p></details></main><script type="module" src="${scriptPath}"></script></body></html>`;
}

// Native test and the Local Wall use this same browser decoder. All packets are
// independent IDRs, so overload can discard the older frame without a GOP.
export const WALL_VIDEO_SCRIPT=String.raw`
export class IndependentH264Viewer {
 constructor(canvas,onError=()=>{}){this.canvas=canvas;this.onError=onError;this.decoder=null;this.codec='';this.generation=0;this.decoded=0;this.dropped=0;this.closed=false;}
 async push(packet){
  if(this.closed)return;
  if(packet?.format!=='annexb'||packet.keyFrame!==true||!/^avc1\.[0-9a-f]{6}$/i.test(packet.codec)||!Number.isInteger(packet.width)||!Number.isInteger(packet.height)||packet.width<2||packet.width>1280||packet.height<2||packet.height>720||typeof packet.data!=='string'||packet.data.length>900000)throw Error('Invalid video packet');
  if(typeof VideoDecoder!=='function')throw Error('This browser cannot decode H.264 video. Use a current Chrome or Edge.');
  let generation=this.generation;
  if(!this.decoder||this.codec!==packet.codec){
   this.clear();generation=this.generation;this.codec=packet.codec;
   const config={codec:packet.codec,optimizeForLatency:true,hardwareAcceleration:'prefer-hardware'};
   let support=await VideoDecoder.isConfigSupported(config);
   if(!support.supported){config.hardwareAcceleration='no-preference';support=await VideoDecoder.isConfigSupported(config);}
   if(this.closed||generation!==this.generation)return;
   if(!support.supported)throw Error('H.264 decoding is unavailable in this browser.');
   this.decoder=new VideoDecoder({output:frame=>{try{if(!this.closed&&generation===this.generation){this.canvas.width=frame.displayWidth;this.canvas.height=frame.displayHeight;this.canvas.getContext('2d').drawImage(frame,0,0);this.canvas.hidden=false;this.decoded++;}}finally{frame.close();}},error:error=>{if(generation===this.generation)this.onError(error);}});
   this.decoder.configure(support.config);
  }
  if(this.closed||generation!==this.generation)return;
  if(this.decoder.decodeQueueSize>=2){this.dropped++;return;}
  const bytes=Uint8Array.from(atob(packet.data),c=>c.charCodeAt(0));
  if(bytes.length!==packet.dataBytes||bytes.length>650*1024)throw Error('Invalid video payload length');
  this.decoder.decode(new EncodedVideoChunk({type:'key',timestamp:packet.timestampUs,data:bytes}));
 }
 async flush(){if(this.decoder?.state==='configured')await this.decoder.flush();}
 clear(){this.generation++;if(this.decoder&&this.decoder.state!=='closed')this.decoder.close();this.decoder=null;this.codec='';this.canvas.hidden=true;this.canvas.getContext('2d').clearRect(0,0,this.canvas.width,this.canvas.height);}
 close(){if(this.closed)return;this.clear();this.closed=true;}
}
if(typeof document!=='undefined'&&document.getElementById('screen')){
 const canvas=document.getElementById('screen'),empty=document.getElementById('empty'),select=document.getElementById('stream'),status=document.getElementById('status'),metrics=document.getElementById('metrics');
 let selected='',lastSequence=0,lastEpoch='',paused=false,alive=true;
 const viewer=new IndependentH264Viewer(canvas,error=>{status.textContent=error.message;viewer.clear();empty.hidden=false;});
 function clear(message){viewer.clear();lastSequence=0;status.textContent=message;empty.hidden=false;}
 select.onchange=()=>{selected=select.value;clear('Waiting for a fresh frame');};
 document.getElementById('pause').onclick=event=>{paused=!paused;event.target.textContent=paused?'Resume view':'Pause view';if(paused)clear('View paused');};
 async function poll(){
  while(alive){
   try{
    if(!paused&&!document.hidden){
     const query=new URLSearchParams({desktopSessionId:selected,afterSeq:String(lastSequence),afterEpoch:lastEpoch});
     const response=await fetch(document.body.dataset.latestPath+'?'+query,{cache:'no-store',credentials:'same-origin'});
     if(!response.ok)throw Error(response.status===403?'Sign in to Wall to view video.':'Video is unavailable.');
     const data=await response.json(),rows=Array.isArray(data.streams)?data.streams:[];
     const prior=selected;select.replaceChildren(...rows.map((row,index)=>new Option('AI desktop '+(index+1),row.desktopSessionId)));
     selected=rows.some(row=>row.desktopSessionId===prior)?prior:rows[0]?.desktopSessionId||'';select.value=selected;
     if(selected!==prior){lastSequence=0;viewer.clear();}
     const row=rows.find(row=>row.desktopSessionId===selected);
     if(!row){clear('No recent AI video');}
     else if(row.frameSeq!==lastSequence||row.epoch!==lastEpoch){
      if(row.epoch!==lastEpoch){viewer.clear();lastSequence=0;lastEpoch=row.epoch;}
      await viewer.push(row.video);lastSequence=row.frameSeq;empty.hidden=true;status.textContent='Live AI video';
      metrics.textContent=(row.video.hardwareEncoding?'Hardware encoder':'Software encoder')+' · '+row.video.width+' × '+row.video.height+' · '+Math.round(row.video.dataBytes/1024)+' KB/frame\n'+(row.video.gpuResize?'GPU crop/resize':'CPU capture/resize')+' · decoded '+viewer.decoded+' · skipped '+viewer.dropped;
     }
    }
   }catch(error){clear(error.message);}
   await new Promise(resolve=>setTimeout(resolve,100));
  }
 }
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear('View paused while hidden');});
 addEventListener('pagehide',()=>{alive=false;viewer.close();},{once:true});void poll();
}
`;
