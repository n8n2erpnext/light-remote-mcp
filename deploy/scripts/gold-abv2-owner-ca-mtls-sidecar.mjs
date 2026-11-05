/**
 * GoldABV2 isolated Lab-only Traefik TLS1.3 mTLS -> LXD-loopback Plugin.
 * An HTTPS sidecar, NOT native in-process Plugin TLS. Never expose 5583.
 *
 * SSO bridge proof: any incoming caller-supplied x-light-remote-edge-proof-v4
 * is STRIPPED. When explicitly provisioned with a restricted local secret
 * file, the sidecar itself stamps the exact POST ticket path only.
 * Feature remains OFF unless the separate Plugin AND Operator gates opt in.
 */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

const DIR='/opt/light-remote-abv2-lab/mtls-runtime-20261104';
const HOST='127.0.0.1',PORT=5584,BACKEND_PORT=5583;
const NATIVE_TICKET='/account/desktop/v4/wall-sso/ticket';
const EDGE_HEADER='x-light-remote-edge-proof-v4';
const fail=why=>{throw new Error('gold_lab_mtls_sidecar_'+why);};
const hex=/^[0-9a-f]{64}$/;
const forbiddenHeaders=new Set([
 'connection','proxy-connection','keep-alive','te','trailer',
 'transfer-encoding','upgrade','proxy-authorization',
 'forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto',
 'x-forwarded-port','x-real-ip','x-original-forwarded-for',
 EDGE_HEADER
]);

/**
 * Pure transformer, independently testable without CA or opening a socket.
 * Every inbound pseudo-trust header is ignored, even when an attacker
 * sends an exact-looking value. Only local per-service proof can be added.
 */
export function outgoingHeaders(incoming,{
 method='',url='',edgeProof=null
}={}){
 if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))
   fail('headers_invalid');
 if(edgeProof!==null&&(!hex.test(edgeProof)||typeof edgeProof!=='string'))
   fail('edge_proof_invalid');
 const ret={};
 for(const [name,value] of Object.entries(incoming)){
   const key=name.toLowerCase();
   if(forbiddenHeaders.has(key)||key.startsWith('x-forwarded-')||
      key.startsWith('x-original-'))
     continue;
   ret[key]=value;
 }
 ret['x-forwarded-proto']='https';
 ret['x-forwarded-port']='443';
 if(typeof ret.host==='string'&&ret.host.length<256)
   ret['x-forwarded-host']=ret.host;
 if(edgeProof!==null&&method==='POST'&&url===NATIVE_TICKET)
   ret[EDGE_HEADER]=edgeProof;
 return ret;
}

function loadEdgeProofFile(){
 const filename=process.env.GOLD_LAB_MTLS_SSO_EDGE_PROOF_FILE_V4;
 if(filename===undefined||filename==='')return null;
 if(!path.isAbsolute(filename))fail('edge_proof_file_not_absolute');
 let st;
 try{st=fs.lstatSync(filename);}
 catch{fail('edge_proof_file_missing');}
 if(!st.isFile()||st.isSymbolicLink()||
    st.size<64||st.size>65||(st.mode&0o077)!==0)
   fail('edge_proof_file_permissions_invalid');
 const proof=fs.readFileSync(filename,'utf8').trim();
 if(!hex.test(proof))fail('edge_proof_format_invalid');
 return proof;
}

function openBridge(){
 const old=process.env.GOLD_LAB_MTLS_OLD_SHA256;
 const next=process.env.GOLD_LAB_MTLS_NEXT_SHA256;
 if(!hex.test(old??'')||!hex.test(next??'')||old===next)
   fail('invalid_client_pin_configuration');
 const pins=[Buffer.from(old,'hex'),Buffer.from(next,'hex')];
 const edgeProof=loadEdgeProofFile();
 const config={
   cert:fs.readFileSync(DIR+'/server.crt'),
   key:fs.readFileSync(DIR+'/server.key'),
   ca:fs.readFileSync(DIR+'/ca.crt'),
   minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
   requestCert:true,rejectUnauthorized:true
 };
 function clientAuthorized(socket){
   const raw=socket?.getPeerCertificate?.(true)?.raw;
   if(!socket?.encrypted||!socket?.authorized||!Buffer.isBuffer(raw))
     return false;
   const actual=crypto.createHash('sha256').update(raw).digest();
   let ok=0;
   for(const expected of pins)
     ok|=Number(crypto.timingSafeEqual(actual,expected));
   return ok===1;
 }
 const server=https.createServer(config,(req,res)=>{
   if(!clientAuthorized(req.socket)){
     res.writeHead(403,{'cache-control':'no-store','content-length':'0'});
     res.end();return;
   }
   const proxy=http.request({
     hostname:HOST,port:BACKEND_PORT,method:req.method,
     path:req.url,
     headers:outgoingHeaders(req.headers,{
       method:req.method,url:req.url,edgeProof
     }),
     agent:false,timeout:30000
   },upstream=>{
     if(!res.headersSent)
       res.writeHead(upstream.statusCode??502,upstream.headers);
     upstream.pipe(res);
   });
   proxy.on('timeout',()=>proxy.destroy(new Error('timeout')));
   proxy.on('error',()=>{
     if(!res.headersSent)
       res.writeHead(502,{'cache-control':'no-store'});
     res.end();
   });
   req.on('aborted',()=>proxy.destroy());
   req.pipe(proxy);
 });
 server.on('upgrade',(_req,socket)=>socket.destroy());
 server.headersTimeout=15000;
 server.requestTimeout=120000;
 server.keepAliveTimeout=5000;
 server.maxHeadersCount=100;
 server.listen(PORT,HOST,()=>{
   console.log('GOLD_LAB_MTLS_BRIDGE_READY TLS1.3 client-cert-required OLD_NEXT');
 });
 for(const signal of ['SIGINT','SIGTERM'])
   process.on(signal,()=>server.close(()=>process.exit(0)));
 return server;
}
if(process.argv[1]&&import.meta.url===
   pathToFileURL(path.resolve(process.argv[1])).href)
 openBridge();
