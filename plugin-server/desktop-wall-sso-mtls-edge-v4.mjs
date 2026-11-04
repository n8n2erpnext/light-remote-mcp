/**
 * T04b8-A2 SOURCE ONLY: optional mTLS-only second listener for the Gold Plugin.
 *
 * On the isolated Lab, Traefik must eventually reach ONLY this listener via
 * a new LXD proxy. The old plaintext LXD proxy MUST be removed or isolated
 * before any Owner/Token/SSO flag is enabled. Creating this listener does not
 * turn on SSO, issue an Owner token, or authorize Agent A/B.
 *
 * Certificate/key/CA files are provisioned outside Git, with private
 * permissions and separate trust roots. This source never generates, logs
 * or returns certificate material.
 */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const FLAG='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_EDGE_V4';
const PORT='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_PORT_V4';
const CERT='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CERT_PATH_V4';
const KEY='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_KEY_PATH_V4';
const CA='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CLIENT_CA_PATH_V4';
const CLIENT_SHA='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CLIENT_SHA256_V4';
const CLIENT_SHA_NEXT='LR_GOLD_ABV2_DESKTOP_WALL_SSO_MTLS_CLIENT_SHA256_NEXT_V4';
const PROXY_PEERS='LR_GOLD_ABV2_DESKTOP_WALL_SSO_PROXY_PEERS_V4';
const fail=()=>{throw new Error('desktop_wall_sso_mtls_edge_unavailable');};

export function createDesktopWallSsoMtlsEdgeV4({
  env={},app,readFile=fs.readFileSync,createServer=https.createServer
}={}){
  if(env?.[FLAG]!=='1')
    return Object.freeze({enabled:false,server:null});
  if(typeof app!=='function'||typeof readFile!=='function'||
     typeof createServer!=='function'||env?.[PROXY_PEERS])
    fail();
  const rawPort=env[PORT];
  if(!/^[1-9][0-9]{3,4}$/.test(String(rawPort||'')))fail();
  const port=Number(rawPort);
  if(!Number.isSafeInteger(port)||port<1024||port>65535||
     !/^[a-f0-9]{64}$/.test(String(env[CLIENT_SHA]||'')))fail();
  // Optional second client leaf for a bounded no-gap rotation window.
  // Only these exact two SHA-256 DER fingerprints may reach Express.
  const nextClientSha=env?.[CLIENT_SHA_NEXT];
  if(nextClientSha!==undefined&&
     (!/^[a-f0-9]{64}$/.test(String(nextClientSha))||
      nextClientSha===env[CLIENT_SHA]))fail();
  const expectedClients=[Buffer.from(env[CLIENT_SHA],'hex')];
  if(nextClientSha!==undefined)
    expectedClients.push(Buffer.from(nextClientSha,'hex'));
  for(const name of [CERT,KEY,CA])
    if(typeof env[name]!=='string'||!path.isAbsolute(env[name])||
       env[name].includes('\0'))fail();
  let cert,key,ca;
  try{
    cert=readFile(env[CERT]);
    key=readFile(env[KEY]);
    ca=readFile(env[CA]);
  }catch{fail();}
  if(![cert,key,ca].every(x=>Buffer.isBuffer(x)&&x.length>=20))fail();

  // TLS 1.3 and an independently trusted CLIENT certificate are mandatory.
  // No spoofed forwarded headers or plaintext HTTP bypass this listener.
  const server=createServer({
    cert,key,ca,minVersion:'TLSv1.3',maxVersion:'TLSv1.3',
    requestCert:true,rejectUnauthorized:true
  },(req,res)=>{
    const raw=req.socket?.getPeerCertificate?.(true)?.raw;
    const actual=Buffer.isBuffer(raw)
      ?crypto.createHash('sha256').update(raw).digest():null;
    // Evaluate each configured pin, even if the first matches.
    let pinned=0;
    if(actual)
      for(const expected of expectedClients)
        pinned|=Number(crypto.timingSafeEqual(actual,expected));
    if(req.socket?.encrypted!==true||req.socket?.authorized!==true||
       pinned!==1){
      res.writeHead(403,{'Cache-Control':'no-store'});
      res.end();
      return;
    }
    app(req,res);
  });
  if(!server||typeof server.listen!=='function'||typeof server.close!=='function')
    fail();
  return Object.freeze({enabled:true,server,host:'127.0.0.1',port});
}
