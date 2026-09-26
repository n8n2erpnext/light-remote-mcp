import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startLocalWall } from '../../device-agent/local-wall.mjs';
import { NativeDesktopBridge } from '../../lib/native-desktop.mjs';

const exe=String(process.argv[2]||process.env.LIGHT_REMOTE_CLIENT_EXE||'').trim();
if(process.platform!=='win32'){console.log('windows-local-wall-desktop=SKIP windows-only');process.exit(0);}
if(!exe||!fs.existsSync(exe))throw new Error('real_remote_helper_missing');

const port=28500+(process.pid%2000);
const brand=path.resolve('assets/branding/light-remote-mark.svg');
const bridge=new NativeDesktopBridge({command:exe,timeoutMs:12000});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function desktopAction(data={}){
  const op=String(data.op||'');
  if(op==='status')return {ok:true,operation:op,desktop:await bridge.request('status',{})};
  if(op==='attach')return {ok:true,operation:op,desktop:await bridge.request('attach',{
    screen:data.screen==null?-1:clamp(Number(data.screen)||0,-1,31),
    maxWidth:clamp(Number(data.maxWidth)||960,320,1280),
    maxHeight:clamp(Number(data.maxHeight)||540,180,720),
    quality:clamp(Number(data.quality)||50,25,70),
    minIntervalMs:clamp(Number.isFinite(Number(data.minIntervalMs))?Math.floor(Number(data.minIntervalMs)):250,0,5000),
    omitUnchanged:data.omitUnchanged!==false,
    idleTimeoutMs:clamp(Number.isFinite(Number(data.idleTimeoutMs))?Math.floor(Number(data.idleTimeoutMs)):120000,250,900000)
  },{timeoutMs:10000})};
  if(op==='frame')return {ok:true,operation:op,desktop:await bridge.request('frame',{
    desktopSessionId:String(data.desktopSessionId||''),
    screen:data.screen==null?-1:clamp(Number(data.screen)||0,-1,31),
    maxWidth:clamp(Number(data.maxWidth)||960,320,1280),
    maxHeight:clamp(Number(data.maxHeight)||540,180,720),
    quality:clamp(Number(data.quality)||50,25,70)
  },{timeoutMs:10000})};
  if(op==='resume'||op==='detach')return {ok:true,operation:op,desktop:await bridge.request(op,{desktopSessionId:String(data.desktopSessionId||'')},{timeoutMs:10000})};
  throw new Error('desktop_operation_unsupported');
}

const wall=startLocalWall({
  host:'127.0.0.1',port,brandSvgPath:brand,
  getLocalStatus:async()=>({
    ok:true,enrolled:true,deviceId:'windows-ci',deviceName:'WINDOWS-CI',
    effectiveCapabilities:['desktop'],grantableCapabilities:['desktop','desktop-input'],
    approvedCapabilities:['desktop','desktop-input'],deniedCapabilities:['desktop-input'],
    cloudDesiredConnected:false,cloudState:'dormant'
  }),
  getRemoteStatus:async()=>null,getRemoteActivity:async()=>({events:[]}),
  desktopAction
});

function req(method,target,payload){
  return new Promise((resolve,reject)=>{
    const data=payload==null?null:Buffer.from(JSON.stringify(payload));
    const headers=data?{'content-type':'application/json','content-length':String(data.length)}:{};
    const r=http.request({host:'127.0.0.1',port,method,path:target,headers},res=>{
      let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>{
        let json=null;try{json=JSON.parse(text)}catch{}
        resolve({status:res.statusCode,text,json});
      });
    });
    r.on('error',reject);if(data)r.write(data);r.end();
  });
}

await sleep(100);
let desktopSessionId='';
try{
  const page=await req('GET','/desktop');
  if(page.status!==200||!page.text.includes('Real Remote Desktop - Local Wall')||!page.text.includes('/api/desktop')||!page.text.includes('inputMapping'))throw new Error('windows_local_wall_desktop_page_failed');

  const status=await req('POST','/api/desktop',{op:'status'});
  const live=status.json?.desktop;
  if(status.status!==200||!status.json?.ok||!live?.interactive||!Array.isArray(live.screens)||live.screens.length<1)throw new Error('windows_local_wall_desktop_status_failed');
  const selected=live.screens.find(x=>x.primary)||live.screens[0];

  const attached=await req('POST','/api/desktop',{op:'attach',screen:selected.index,maxWidth:320,maxHeight:180,quality:30,minIntervalMs:300,omitUnchanged:true,idleTimeoutMs:5000});
  const a=attached.json?.desktop;
  desktopSessionId=String(a?.desktopSessionId||'');
  if(attached.status!==200||!desktopSessionId||!a?.displayTopologyId||Number(a.frameSeq)!==0||Number(a.contentSeq)!==0)throw new Error('windows_local_wall_desktop_attach_failed');

  let frame=await req('POST','/api/desktop',{op:'frame',desktopSessionId});
  let f=frame.json?.desktop;
  if(f?.throttled){await sleep(Number(f.retryAfterMs||300)+30);frame=await req('POST','/api/desktop',{op:'frame',desktopSessionId});f=frame.json?.desktop;}
  if(frame.status!==200||!f||f.throttled||f.mime!=='image/jpeg'||f.encoding!=='base64'||!f.data||Number(f.bytes)<=0||!f.inputMapping||f.displayTopologyId!==a.displayTopologyId)throw new Error('windows_local_wall_desktop_frame_failed');

  const resumed=await req('POST','/api/desktop',{op:'resume',desktopSessionId});
  const rr=resumed.json?.desktop;
  if(resumed.status!==200||rr?.desktopSessionId!==desktopSessionId||rr?.displayTopologyId!==a.displayTopologyId||Number(rr.frameSeq)<1)throw new Error('windows_local_wall_desktop_resume_failed');

  const detached=await req('POST','/api/desktop',{op:'detach',desktopSessionId});
  if(detached.status!==200||detached.json?.desktop?.desktopSessionId!==desktopSessionId||detached.json?.desktop?.detached!==true)throw new Error('windows_local_wall_desktop_detach_failed');
  desktopSessionId='';

  console.log('windows-local-wall-desktop-page=PASS');
  console.log('windows-local-wall-desktop-native-frame=PASS screen='+selected.index+' bytes='+f.bytes+' frameSeq='+f.frameSeq+' contentSeq='+f.contentSeq);
  console.log('windows-local-wall-desktop-session=PASS');
} finally {
  if(desktopSessionId){try{await desktopAction({op:'detach',desktopSessionId});}catch{}}
  bridge.close();
  await wall.close();
}
