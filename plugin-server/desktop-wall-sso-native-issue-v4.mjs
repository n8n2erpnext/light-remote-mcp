/**
 * T04b7: native-Owner-only HTTPS Wall transfer-ticket request handler.
 * SOURCE ONLY: this file does not register an Express route.
 *
 * A native Desktop process already holds a scoped Owner access token in the
 * OS vault. The token is accepted as a Bearer request header, never from a
 * query, cookie, body or browser origin. The trusted issuer must independently
 * verify current Owner + enrolled device, and issue a single-use 45s ticket.
 * This handler never returns bearer/refresh secrets, A/B grants or Wall cookies.
 */
import net from 'node:net';
import crypto from 'node:crypto';

const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const DEVICE=/^[A-Za-z0-9._:-]{1,160}$/;
const EDGE_PROOF=/^[a-f0-9]{64}$/;
const PURPOSE='desktop_wall_sso_v4';

const exact=(row,names)=>{
  if(!row||typeof row!=='object'||Array.isArray(row))return false;
  const keys=Object.keys(row);
  return keys.length===names.length&&keys.every(k=>names.includes(k));
};
const normalizedIp=value=>{
  const ip=String(value||'').replace(/^::ffff:/,'');
  return net.isIP(ip)?ip:null;
};
const noCache=res=>{
  res.set('Cache-Control','no-store');
  res.set('Pragma','no-cache');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Content-Type-Options','nosniff');
};
const reject=(res,status,reason)=>
  res.status(status).json({ok:false,error:reason});

export function createDesktopWallSsoNativeIssueV4({
  enabled=false,publicOrigin,proxyPeers=[],edgeProofSecret,issueTrusted,clock=Date.now
}={}){
  if(enabled!==true)return Object.freeze({enabled:false,handler:null});
  let expected;
  try{expected=new URL(publicOrigin)}catch{}
  if(expected?.protocol!=='https:'||expected?.pathname!=='/'||
     expected?.search||expected?.hash||expected?.username||expected?.password||
     typeof issueTrusted!=='function'||typeof clock!=='function'||
     !Array.isArray(proxyPeers)||proxyPeers.some(ip=>normalizedIp(ip)!==ip))
    throw new Error('desktop_wall_sso_native_issuer_unavailable');
  // LXD's TCP proxy can make *untrusted direct HTTP* appear to come from
  // 127.0.0.1, the same socket peer as real Traefik HTTPS forwarding.
  // Source IP + X-Forwarded-Proto therefore cannot attest TLS ingress.
  // Require a separate non-public 256-bit edge proof for all HTTP hops;
  // the TLS-only Traefik router must OVERRIDE any caller-supplied copy.
  if(proxyPeers.length && !EDGE_PROOF.test(String(edgeProofSecret||'')))
    throw new Error('desktop_wall_sso_edge_proof_unavailable');
  const trustedPeers=new Set(proxyPeers);
  const expectedProof=proxyPeers.length
    ?Buffer.from(edgeProofSecret,'hex'):null;
  const verifiedEdgeProof=value=>{
    if(!expectedProof||typeof value!=='string'||!EDGE_PROOF.test(value))
      return false;
    return crypto.timingSafeEqual(Buffer.from(value,'hex'),expectedProof);
  };
  const secureTransport=req=>{
    if(String(req.headers?.host||'')!==expected.host)return false;
    if(req.socket?.encrypted===true)return true;
    // The public HTTPS terminator MUST be explicitly allowlisted by exact IP.
    // Neither Express req.secure nor the allowlisted TCP peer is sufficient.
    // Traefik must overwrite this private header on its TLS-only route.
    const peer=normalizedIp(req.socket?.remoteAddress);
    return Boolean(peer&&trustedPeers.has(peer)&&req.secure===true&&
      verifiedEdgeProof(req.headers?.['x-light-remote-edge-proof-v4'])&&
      req.headers?.['x-forwarded-proto']==='https'&&
      (!req.headers?.['x-forwarded-host']||
       req.headers['x-forwarded-host']===expected.host));
  };

  async function handler(req,res){
    noCache(res);
    if(req.method!=='POST'||String(req.originalUrl||req.url||'').includes('?')||
       !secureTransport(req))
      return reject(res,403,'desktop_wall_sso_native_required');
    const headers=req.headers||{};
    if(headers.origin||headers.cookie||headers.referer||
       headers['sec-fetch-site']||headers['sec-fetch-mode']||
       headers['sec-fetch-dest']||headers['transfer-encoding']||
       String(headers['content-type']||'').split(';')[0].trim()!=='application/json'||
       !/^\d{1,4}$/.test(String(headers['content-length']||''))||
       Number(headers['content-length'])>2048)
      return reject(res,403,'desktop_wall_sso_native_required');
    const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(
      String(headers.authorization||'')
    );
    if(!match||!TOKEN.test(match[1]))
      return reject(res,401,'desktop_wall_sso_owner_required');
    if(!exact(req.body,['device_id'])||
       !DEVICE.test(String(req.body.device_id||'')))
      return reject(res,400,'desktop_wall_sso_request_invalid');
    try{
      const issued=await issueTrusted({
        accessToken:match[1],deviceId:req.body.device_id
      });
      const now=Number(clock());
      if(!exact(issued,['ticket','expiresAt','deviceId','purpose'])||
         !TOKEN.test(String(issued.ticket||''))||
         !Number.isSafeInteger(now)||
         !Number.isSafeInteger(issued.expiresAt)||
         issued.expiresAt<=now||issued.expiresAt>now+45_000||
         issued.deviceId!==req.body.device_id||
         issued.purpose!==PURPOSE)
        throw Error('desktop_wall_sso_issue_invalid');
      return res.status(200).json({
        ok:true,ticket:issued.ticket,expiresAt:issued.expiresAt,
        deviceId:issued.deviceId
      });
    }catch{
      // Never reflect an upstream Owner/Redis/signature error, credential,
      // session ID, family ID or private Agent identity to the caller.
      return reject(res,403,'desktop_wall_sso_issue_denied');
    }
  }
  return Object.freeze({enabled:true,handler});
}
