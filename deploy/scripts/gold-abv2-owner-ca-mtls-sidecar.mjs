/**
 * GoldABV2 isolated Lab-only Traefik -> TLS1.3 client-auth -> local Plugin bridge.
 *
 * This is a TLS terminator alongside the Plugin, not an in-process Plugin mTLS
 * listener. Traffic from the bridge to the Plugin stays on LXD loopback.
 * Public network must NEVER expose loopback plaintext port 5583.
 * Pinned client leaf DER fingerprints, separate CA trust, no forwarded-header trust.
 */
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import crypto from 'node:crypto';

const DIR='/opt/light-remote-abv2-lab/mtls-runtime-20261104';
const HOST='127.0.0.1',PORT=5584,BACKEND_PORT=5583;
const fail=why=>{throw new Error('gold_lab_mtls_sidecar_'+why);};
const hex=/^[0-9a-f]{64}$/;
const old=process.env.GOLD_LAB_MTLS_OLD_SHA256;
const next=process.env.GOLD_LAB_MTLS_NEXT_SHA256;
if(!hex.test(old??'')||!hex.test(next??'')||old===next)fail('invalid_client_pin_configuration');
const pins=[Buffer.from(old,'hex'),Buffer.from(next,'hex')];
const config={
 cert:fs.readFileSync(DIR+'/server.crt'),
 key:fs.readFileSync(DIR+'/server.key'),
 ca:fs.readFileSync(DIR+'/ca.crt'),
 minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
 requestCert:true,rejectUnauthorized:true
};
function clientAuthorized(socket){
 const raw=socket?.getPeerCertificate?.(true)?.raw;
 if(!socket?.encrypted||!socket?.authorized||!Buffer.isBuffer(raw))return false;
 const actual=crypto.createHash('sha256').update(raw).digest();
 let ok=0;
 for(const expected of pins)ok|=Number(crypto.timingSafeEqual(actual,expected));
 return ok===1;
}
const hopByHop=['connection','proxy-connection','keep-alive','te',
 'trailer','transfer-encoding','upgrade','proxy-authorization',
 'forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto',
 'x-forwarded-port','x-real-ip','x-original-forwarded-for'];
function outgoingHeaders(incoming){
 const ret={...incoming};
 for(const h of hopByHop)delete ret[h];
 for(const key of Object.keys(ret)){
  if(key.startsWith('x-forwarded-')||key.startsWith('x-original-'))delete ret[key];
 }
 // This is set by the authenticated TLS boundary, not accepted from client.
 ret['x-forwarded-proto']='https';
 ret['x-forwarded-port']='443';
 if(typeof incoming.host==='string'&&incoming.host.length<256)
  ret['x-forwarded-host']=incoming.host;
 return ret;
}
const server=https.createServer(config,(req,res)=>{
 if(!clientAuthorized(req.socket)){
  res.writeHead(403,{'cache-control':'no-store','content-length':'0'});
  res.end();return;
 }
 const proxy=http.request({
  hostname:HOST,port:BACKEND_PORT,method:req.method,
  path:req.url,headers:outgoingHeaders(req.headers),
  agent:false,timeout:30000
 },upstream=>{
  if(!res.headersSent)res.writeHead(upstream.statusCode??502,upstream.headers);
  upstream.pipe(res);
 });
 proxy.on('timeout',()=>proxy.destroy(new Error('timeout')));
 proxy.on('error',()=>{
  if(!res.headersSent)res.writeHead(502,{'cache-control':'no-store'});
  res.end();
 });
 req.on('aborted',()=>proxy.destroy());
 req.pipe(proxy);
});
server.on('upgrade',(_req,socket)=>{
 // Upgrade not part of approved tested MCP/health transport; fail-closed.
 socket.destroy();
});
server.headersTimeout=15000;
server.requestTimeout=120000;
server.keepAliveTimeout=5000;
server.maxHeadersCount=100;
server.listen(PORT,HOST,()=>{
 console.log('GOLD_LAB_MTLS_BRIDGE_READY TLS1.3 client-cert-required OLD_NEXT');
});
for(const signal of ['SIGINT','SIGTERM']){
 process.on(signal,()=>server.close(()=>process.exit(0)));
}
