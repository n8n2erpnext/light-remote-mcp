import http from 'node:http';
import path from 'node:path';
import { startLocalWall } from '../../device-agent/local-wall.mjs';

const port=28500+(process.pid%2000);
const brand=path.resolve('assets/branding/light-remote-mark.svg');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

const wall=startLocalWall({
  host:'127.0.0.1',port,brandSvgPath:brand,
  getLocalStatus:async()=>({
    ok:true,enrolled:true,deviceId:'windows-ci',deviceName:'WINDOWS-CI',
    effectiveCapabilities:['desktop'],grantableCapabilities:['desktop','desktop-input'],
    approvedCapabilities:['desktop','desktop-input'],deniedCapabilities:['desktop-input'],
    cloudDesiredConnected:false,cloudState:'dormant'
  }),
  getRemoteStatus:async()=>null,getRemoteActivity:async()=>({events:[]})
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

await sleep(80);
try{
  const root=await req('GET','/');
  if(root.status!==200||!root.text.includes('Permissions')||root.text.includes('href="/desktop"')||root.text.includes('>Desktop</span>'))throw new Error('windows_local_wall_rm_root_contract_failed');

  const permissions=await req('GET','/permissions');
  if(permissions.status!==200||!permissions.text.includes('Enable Real Remote')||!permissions.text.includes('Allow Remote control')||!permissions.text.includes('desktop-input'))throw new Error('windows_local_wall_rm_permissions_contract_failed');

  const removedPage=await req('GET','/desktop');
  if(removedPage.status!==404)throw new Error('windows_local_wall_rm_viewer_route_must_be_removed');

  const removedApi=await req('POST','/api/desktop',{op:'status'});
  if(removedApi.status!==404)throw new Error('windows_local_wall_rm_viewer_api_must_be_removed');

  const status=await req('GET','/api/status');
  if(status.status!==200||!status.json?.ok||!status.json.local?.effectiveCapabilities?.includes('desktop')||status.json.local?.effectiveCapabilities?.includes('desktop-input'))throw new Error('windows_local_wall_rm_permission_state_failed');

  console.log('windows-local-wall-rm-permissions=PASS');
  console.log('windows-local-wall-rm-viewer-removed=PASS');
} finally {
  await wall.close();
}
