import http from 'node:http';
import { createLightRemoteGatewayApp } from '../../gateway/gateway-app.mjs';

const app=createLightRemoteGatewayApp({host:'127.0.0.1',allowedHosts:['127.0.0.1'],deviceResultLimit:'512kb'});
app.post('/device-channel/result',(req,res)=>res.json({ok:true,bytes:Buffer.byteLength(JSON.stringify(req.body))}));
app.post('/ordinary',(req,res)=>res.json({ok:true,bytes:Buffer.byteLength(JSON.stringify(req.body))}));
const server=await new Promise((resolve,reject)=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
const port=server.address().port;
function post(path,size){return new Promise((resolve,reject)=>{const data=Buffer.from(JSON.stringify({payload:'x'.repeat(size)}));const req=http.request({host:'127.0.0.1',port,path,method:'POST',headers:{host:'127.0.0.1','content-type':'application/json','content-length':data.length}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});req.on('error',reject);req.end(data);});}
try{
  const large=await post('/device-channel/result',220*1024);if(large.status!==200)throw new Error('device_result_over_100kb_rejected:'+large.status);
  const ordinary=await post('/ordinary',220*1024);if(ordinary.status!==413)throw new Error('ordinary_json_limit_regressed:'+ordinary.status);
  const tooLarge=await post('/device-channel/result',600*1024);if(tooLarge.status!==413)throw new Error('device_result_limit_not_bounded:'+tooLarge.status);
  console.log('v11-gateway-device-result-large-body-lane=PASS');
}finally{await new Promise(r=>server.close(r));}
