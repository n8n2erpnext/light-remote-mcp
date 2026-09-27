import http from 'node:http';
import { startLocalWall } from '../../device-agent/local-wall.mjs';
const brand=new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname;
const blocker=await new Promise((resolve,reject)=>{const s=http.createServer((_q,r)=>r.end('blocker'));s.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
const port=blocker.address().port;
const wall=startLocalWall({host:'127.0.0.1',port,brandSvgPath:brand,getLocalStatus:async()=>({ok:true,cloudDesiredConnected:false,cloudState:'dormant'})});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=()=>new Promise((resolve,reject)=>{const q=http.get({host:'127.0.0.1',port,path:'/api/status',timeout:500},r=>{let text='';r.on('data',c=>text+=c);r.on('end',()=>resolve({status:r.statusCode,text}));});q.on('timeout',()=>q.destroy(new Error('timeout')));q.on('error',reject);});
try{
  await sleep(250);
  await new Promise(r=>blocker.close(r));
  let response=null;
  for(let i=0;i<40;i++){try{response=await get();if(response.status===200)break;}catch{}await sleep(75);}
  if(response?.status!==200)throw new Error('local_wall_did_not_rebind_after_eaddrinuse');
  console.log('v11-local-wall-eaddrinuse-retry=PASS');
}finally{try{await wall.close();}catch{}try{await new Promise(r=>blocker.close(r));}catch{}}
