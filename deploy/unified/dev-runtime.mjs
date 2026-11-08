import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {spawn} from 'node:child_process';
import {apiPath} from '../../lib/api-contract.mjs';
const config=JSON.parse(fs.readFileSync('/state/runtime-env.json','utf8'));
if(config.LR_UNIFIED_DISPOSABLE_DEV!=='1'||!/^[a-f0-9]{40}$/.test(config.LR_UNIFIED_SOURCE_COMMIT))throw Error('isolated_candidate_required');
for(const name of ['home','run','operator-state','operator-logs','agent-state'])fs.mkdirSync('/state/'+name,{recursive:true,mode:0o700});
Object.assign(process.env,config);
const logs=[];const children=[];
function start(name,file,args=[]){
 const log=fs.openSync(`/state/${name}.private.log`,'a',0o600);logs.push(log);
 const child=spawn(process.execPath,[file,...args],{env:process.env,stdio:['ignore',log,log]});children.push(child);
 child.on('exit',(code,signal)=>{console.error(`${name}_exit`,code,signal);if(!stopping)stop(1)});
}
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(code),1500).unref()}
process.on('SIGTERM',()=>stop());process.on('SIGINT',()=>stop());
start('operator','operator-host/executor.mjs');
start('plugin','plugin-server/server.mjs');
// Enrollment/approval use real public APIs in acceptance. Start the actual
// signed Agent only after its own CLI has connected its new private identity.
const agentWatch=setInterval(()=>{
 try{
  const state=JSON.parse(fs.readFileSync('/state/home/.config/gpt-operator-agent-goldabv2/device.json','utf8'));
  if(state.enrollment?.deviceId&&state.cloud?.desiredConnected===true){
   clearInterval(agentWatch);start('agent','device-agent/operator-agent.mjs',['daemon']);
  }
 }catch{}
},500);
agentWatch.unref();
const origin=new URL(config.LIGHT_REMOTE_PLUGIN_ORIGIN);
const clientCert=fs.readFileSync('/state/pki/edge-client.crt');
const clientKey=fs.readFileSync('/state/pki/edge-client.key');
const edgeCA=fs.readFileSync('/state/pki/edge-ca.crt');
// Transport only. All authorization remains in the real Plugin and Operator.
// Incoming forwarded/TLS-identity headers are discarded before proxying.
const proxy=https.createServer({key:fs.readFileSync('/state/pki/public.key'),cert:fs.readFileSync('/state/pki/public.crt'),minVersion:'TLSv1.3'},(req,res)=>{
 const headers={};for(const [key,value] of Object.entries(req.headers))if(!key.startsWith('x-forwarded-')&&!key.startsWith('x-lr-')&&!['forwarded','host','connection','x-client-cert','x-ssl-client-verify'].includes(key))headers[key]=value;
 headers.host=origin.host;
 const ticket=req.url?.split('?')[0]===apiPath('ownerWallTicket');
 const upstream=(ticket?https:http).request({hostname:'127.0.0.1',port:ticket?5496:5495,path:req.url,method:req.method,headers,...(ticket?{cert:clientCert,key:clientKey,ca:edgeCA,servername:origin.hostname,rejectUnauthorized:true,minVersion:'TLSv1.3'}:{})},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res)});
 upstream.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});res.end('{"ok":false,"error":"candidate_starting"}')});
 req.pipe(upstream);
});
proxy.listen(443,'0.0.0.0',()=>console.log('unified_private_transport_ready'));
