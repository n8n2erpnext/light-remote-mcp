import {API_CONTRACT_VERSION,API_VERSION_HEADER} from '../lib/api-contract.mjs';
import fs from 'node:fs';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { PUBLIC_ALLOWED_HOSTS, PUBLIC_HOST, PUBLIC_ORIGIN, PUBLIC_PORT, OPENAI_CHALLENGE_FILE, VERSION, MCP_SURFACE_VERSION } from './config.mjs';
import { authenticateAccess, registerOAuth, initializeOAuthRedis } from './oauth.mjs';
import { registerPublicDeviceRoutes, prunePublicRateState, initializePublicRateRedis } from './device-public.mjs';
import { registerAccountPortal } from './account-portal.mjs';
import { registerDesktopOwnerV4Authorization } from './desktop-auth-v4-server.mjs';
import { registerDesktopOwnerTokenRoutes } from './desktop-owner-token-v4.mjs';
import { callOperatorJson } from './operator-client.mjs';
import { registerDesktopWallSsoNativeIssuerV4,
  desktopWallSsoIssuerEnabledV4,DESKTOP_WALL_SSO_TICKET_PATH_V4,
  DESKTOP_WALL_SSO_MAX_BODY_BYTES_V4
} from './desktop-wall-sso-native-router-v4.mjs';
import {createDesktopWallSsoMtlsEdgeV4} from './desktop-wall-sso-mtls-edge-v4.mjs';
import {DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4} from './desktop-wall-sso-public-redeem-v4.mjs';
import {WALL_SSO_FAMILY_PUBLIC_PATH_V4} from './desktop-wall-sso-public-family-current-v4.mjs';
import { initializeGoldGoogleAuth, initializeGoogleRedis } from './google-auth.mjs';
import { registerDistributionPortal } from './distribution-portal.mjs';
import { registerAdminPortal } from './admin-portal.mjs';
import { installAnnouncements, registerClientAnnouncementFeed, initializeSiteAnnouncements } from './site-announcements.mjs';
import { installSiteAnalytics, flushSiteAnalytics, initializeSiteAnalytics } from './site-analytics.mjs';
import {connectGoldStorage} from '../lib/gold-db.mjs';
import { registerWebAssets } from './web-assets.mjs';
import { renderAiGuidePage, renderLlmsIndex } from './ai-guide-page.mjs';
import { LEGAL_PAGES, renderLegalPage } from './legal-pages.mjs';
import { renderSupportPage } from './support-page.mjs';
import { registerSupportBackoffice, SupportOutbox, initializeSupportRedis } from './support-backoffice.mjs';
import { GoldRegistryPersistence } from '../lib/gold-registry-persistence.mjs';
import { registerPaddleWebhook, paddleBilling } from './paddle-billing.mjs';
import { PLUGIN_TOOL_SECURITY, registerPluginTools } from './tools.mjs';
import { installOpenAiToolSecurityCompat } from './openai-security-compat.mjs';
import { installLegacyToolCallCompat } from './legacy-tool-call-compat.mjs';


// Canonical Plugin refuses to listen without the independent Gold PG17/Redis8.
const goldStorage=await connectGoldStorage();
initializeOAuthRedis(goldStorage.redis,goldStorage.prefix);
initializePublicRateRedis(goldStorage.redis,goldStorage.prefix);
initializeGoogleRedis(goldStorage.redis,goldStorage.prefix);
initializeSupportRedis(goldStorage.redis,goldStorage.prefix);
try{await initializeSiteAnnouncements(goldStorage.pool);await initializeSiteAnalytics(goldStorage.pool,goldStorage.redis,goldStorage.prefix)}
catch(error){await goldStorage.close();throw error}
const goldPluginLease=await goldStorage.pool.connect();
const pluginLeaseOk=(await goldPluginLease.query(
  "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
  ['light_remote_gold:'+goldStorage.prefix+':plugin'])).rows?.[0]?.acquired;
if(pluginLeaseOk!==true){
 goldPluginLease.release();await goldStorage.close();
 throw Error('gold_plugin_single_writer_already_active');
}
const goldPluginStates=await GoldRegistryPersistence.open({pool:goldStorage.pool});
const supportOutbox=goldPluginStates.mount('support_outbox',new SupportOutbox({stateFile:null}));
goldPluginStates.mount('paddle_billing',paddleBilling);
await initializeGoldGoogleAuth(goldStorage.pool);
await goldPluginStates.flush();
const app=express();
app.use((_req,res,next)=>{res.setHeader(API_VERSION_HEADER,API_CONTRACT_VERSION);next();});
// In the existing Express API, never acknowledge a durable Support Outbox
// mutation until its PostgreSQL snapshot is committed.
app.use((_req,res,next)=>{
 const end=res.end.bind(res);let ending=false;
 res.end=function(chunk,encoding,callback){
  if(ending)return res;
  ending=true;
  void goldPluginStates.flush().then(
   ()=>end(chunk,encoding,callback),
   error=>{
    console.error('[gold-plugin-persistence]',error?.message||error);
    if(res.headersSent){res.destroy(error);return}
    res.statusCode=503;
    res.removeHeader('Content-Length');res.removeHeader('ETag');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    end(JSON.stringify({ok:false,error:'gold_postgres_persistence_unavailable'}));
   });
  return res;
 };
 next();
});
// createMcpExpressApp() installs express.json() with Express' default ~100 KB limit.
// Device-channel result envelopes can legitimately exceed that even after client-side compaction,
// so install host validation explicitly and apply the product body limit exactly once.
app.use(hostHeaderValidation(PUBLIC_ALLOWED_HOSTS));
app.disable('x-powered-by');
app.set('trust proxy','loopback, linklocal, uniquelocal');
registerPaddleWebhook(app,express.raw({type:'application/json',limit:'512kb'}));
// T04b7b: when explicitly opted in, parse the native issuer request with
// a 2-KiB ceiling BEFORE the product-wide 12-MiB JSON parser. By default
// this path is neither parsed specially nor registered as an endpoint.
if(desktopWallSsoIssuerEnabledV4(process.env)){
  app.use(DESKTOP_WALL_SSO_TICKET_PATH_V4,
    express.json({limit:DESKTOP_WALL_SSO_MAX_BODY_BYTES_V4,strict:true}));
}
// T04b9c1: SSO device-signed public redeem must not be parsed by the
// broad 12-MiB device-channel body parser. OFF rejects *before* body read.
// ON uses exactly 2 KiB, with separate rate + signature checks downstream.
const publicSsoRedeemEnabledV4=desktopWallSsoIssuerEnabledV4(process.env);
app.use(DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4,(req,res,next)=>{
  if(!publicSsoRedeemEnabledV4||req.method!=='POST')
    return res.status(404).json({ok:false,error:'not_found'});
  next();
},express.json({limit:'2048b',strict:true}));
// T04b9c2: live Owner-family checks use an equally narrow signed route.
// Each protected request creates a NEW Ed25519 nonce; never trust a cached
// browser cookie when the remote Owner family has been revoked.
app.use(WALL_SSO_FAMILY_PUBLIC_PATH_V4,(req,res,next)=>{
  if(!publicSsoRedeemEnabledV4||req.method!=='POST')
    return res.status(404).json({ok:false,error:'not_found'});
  next();
},express.json({limit:'2048b',strict:true}));
const generalJsonBodyParser=express.json({limit:'12mb'});
app.use((req,res,next)=>(req.path===DESKTOP_WALL_SSO_PUBLIC_REDEEM_PATH_V4||
  req.path===WALL_SSO_FAMILY_PUBLIC_PATH_V4)
  ?next():generalJsonBodyParser(req,res,next));
app.use(express.urlencoded({extended:false,limit:'128kb'}));
const PUBLIC_INDEXABLE_PATHS=new Set(['/','/downloads','/downloads/','/support','/privacy','/terms','/cookies','/robots.txt','/sitemap.xml','/site.webmanifest','/favicon.ico']);
app.use((req,res,next)=>{
  const indexable=PUBLIC_INDEXABLE_PATHS.has(req.path);
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy',indexable?'strict-origin-when-cross-origin':'no-referrer');
  // /support displays session-derived account information and must not be cached as a stale guest page.
  res.set('Cache-Control',indexable&&req.path!=='/support'?'public, max-age=300':'no-store');
  if(!indexable)res.set('X-Robots-Tag','noindex, nofollow, noarchive');
  res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  next();
});

installAnnouncements(app);
registerClientAnnouncementFeed(app);
installSiteAnalytics(app);
registerOAuth(app);
registerWebAssets(app);
registerAccountPortal(app);
// GoldABV2 Desktop Owner V4: separate read-only consent and token gates,
// both OFF by default. Never reuse ChatGPT MCP credentials or A/B authority.
const desktopOwnerAuthV4=registerDesktopOwnerV4Authorization(app,{
  enabled:process.env.LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4==='1',
  redis:goldStorage.redis,
  prefix:goldStorage.prefix,
  publicOrigin:PUBLIC_ORIGIN
});
registerDesktopOwnerTokenRoutes(app,{
  enabled:process.env.LR_GOLD_ABV2_DESKTOP_OWNER_AUTH_V4==='1' &&
    process.env.LR_GOLD_ABV2_DESKTOP_TOKEN_V4==='1',
  redis:goldStorage.redis,
  prefix:goldStorage.prefix,
  consumeCode:desktopOwnerAuthV4.consumeCode,
  readEnabled:process.env.LR_GOLD_ABV2_DESKTOP_READ_V4==='1'
});
// Independent opt-in: Desktop Login / Token API flags alone never enable SSO.
// The actual transport is the existing private Operator Unix socket only.
registerDesktopWallSsoNativeIssuerV4(app,{
  env:process.env,publicOrigin:PUBLIC_ORIGIN,
  proxyPeers:process.env.LR_GOLD_ABV2_DESKTOP_WALL_SSO_PROXY_PEERS_V4
    ?process.env.LR_GOLD_ABV2_DESKTOP_WALL_SSO_PROXY_PEERS_V4.split(','):[],
  // Required when SSL terminates at Traefik/LXD: an explicit 256-bit
  // edge attestation value must be injected only by the TLS-only router.
  // Never log, default, generate or expose this private value in the UI.
  edgeProofSecret:process.env.LR_GOLD_ABV2_DESKTOP_WALL_SSO_EDGE_PROOF_V4,
  operatorCall:callOperatorJson
});
registerSupportBackoffice(app,{outbox:supportOutbox});
registerDistributionPortal(app);
registerAdminPortal(app);
registerPublicDeviceRoutes(app);
const pruner=setInterval(()=>prunePublicRateState(),60_000);pruner.unref?.();

app.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(new URL('./public-home.html',import.meta.url),'utf8').replaceAll('__LIGHT_REMOTE_VERSION__',VERSION)));
app.get('/ai-guide',(_q,r)=>r.type('html').send(renderAiGuidePage(fs.readFileSync(new URL('./ai-guide.md',import.meta.url),'utf8'),{origin:PUBLIC_ORIGIN,version:VERSION})));
app.get('/ai-guide.md',(_q,r)=>r.type('text/markdown').send(fs.readFileSync(new URL('./ai-guide.md',import.meta.url),'utf8')));
app.get('/llms.txt',(_q,r)=>r.type('text/plain').send(renderLlmsIndex(PUBLIC_ORIGIN)));
app.get('/llms-full.txt',(_q,r)=>r.type('text/plain').send(fs.readFileSync(new URL('./ai-guide.md',import.meta.url),'utf8')));
app.get('/support',(_q,r)=>r.type('html').send(renderSupportPage({origin:PUBLIC_ORIGIN,version:VERSION})));
app.get('/privacy',(_q,r)=>r.type('html').send(renderLegalPage({active:'privacy',origin:PUBLIC_ORIGIN,...LEGAL_PAGES.privacy})));
app.get('/terms',(_q,r)=>r.type('html').send(renderLegalPage({active:'terms',origin:PUBLIC_ORIGIN,...LEGAL_PAGES.terms})));
app.get('/cookies',(_q,r)=>r.type('html').send(renderLegalPage({active:'cookies',origin:PUBLIC_ORIGIN,...LEGAL_PAGES.cookies})));
app.get('/robots.txt',(_q,r)=>r.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /oauth\nDisallow: /mcp\nDisallow: /operator\nDisallow: /.well-known/openai-apps-challenge\n\nSitemap: '+PUBLIC_ORIGIN+'/sitemap.xml\n'));
app.get('/sitemap.xml',(_q,r)=>{
  const urls=['/','/ai-guide','/downloads','/support','/privacy','/terms','/cookies'];
  const rows=urls.map(p=>'<url><loc>'+PUBLIC_ORIGIN+p+'</loc></url>').join('');
  return r.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+rows+'</urlset>');
});
app.get('/site.webmanifest',(_q,r)=>r.type('application/manifest+json').send(JSON.stringify({name:'Light Remote',short_name:'Light Remote',start_url:'/',display:'standalone',background_color:'#080a0c',theme_color:'#080a0c',icons:[{src:'/account/assets/light-remote.ico',sizes:'any',type:'image/x-icon'}]})));
app.get('/favicon.ico',(_q,r)=>r.redirect(302,'/account/assets/light-remote.ico'));
app.get('/healthz',(_q,r)=>r.json({ok:true,service:'light-remote-direct-plugin',version:VERSION,mcpSurfaceVersion:MCP_SURFACE_VERSION,transport:'direct'}));
app.get('/.well-known/openai-apps-challenge',(_q,r)=>{
  try{const token=fs.readFileSync(OPENAI_CHALLENGE_FILE,'utf8').trim();if(!token)return r.sendStatus(404);return r.type('text/plain').send(token);}
  catch{return r.sendStatus(404);}
});

function mcpServer(identity){
  const server=new McpServer({name:'light-remote',version:MCP_SURFACE_VERSION});
  registerPluginTools(server,identity);
  installLegacyToolCallCompat(server,identity);
  installOpenAiToolSecurityCompat(server,PLUGIN_TOOL_SECURITY);
  return server;
}

app.post('/mcp',async(req,res)=>{
  const {identity}=await authenticateAccess(req);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  const server=mcpServer(identity);
  try{
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  }catch(error){
    console.error('[direct-mcp]',error?.message||error);
    if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',error:{code:-32603,message:'Internal error'},id:req.body?.id??null});
  }finally{
    await transport.close().catch(()=>{});
    await server.close().catch(()=>{});
  }
});
for(const method of ['get','delete'])app[method]('/mcp',(_q,r)=>r.status(405).json({jsonrpc:'2.0',error:{code:-32000,message:'Method not allowed'},id:null}));

app.use((error,req,res,_next)=>{
  const type=String(error?.type||'');
  const parseFailed=type==='entity.parse.failed'||(error instanceof SyntaxError&&Object.prototype.hasOwnProperty.call(error,'body'));
  if(!res.headersSent){
    if(parseFailed)return res.status(400).json({ok:false,error:'invalid_json'});
    if(type==='entity.too.large'||Number(error?.status)===413)return res.status(413).json({ok:false,error:'request_too_large'});
    console.error('[direct-http]',String(error?.message||error||'internal_error').slice(0,240));
    return res.status(500).json({ok:false,error:'internal_error'});
  }
});

// Isolated Lab mTLS transport: OFF by default, always binds inside the
// container to loopback, and NEVER grants Owner/Agent permissions by itself.
const mtlsEdge=createDesktopWallSsoMtlsEdgeV4({env:process.env,app});
const mtlsServer=mtlsEdge.enabled
  ?mtlsEdge.server.listen(mtlsEdge.port,mtlsEdge.host,()=>{
    console.log(JSON.stringify({event:'gold_desktop_wall_sso_mtls_edge_listen',
      host:mtlsEdge.host,port:mtlsEdge.port}));
  }):null;
const server=app.listen(PUBLIC_PORT,PUBLIC_HOST,()=>{
  console.log(JSON.stringify({event:'direct_plugin_listen',origin:PUBLIC_ORIGIN,host:PUBLIC_HOST,port:PUBLIC_PORT,version:VERSION}));
});
let shuttingDown=false;
function shutdown(signal){
  if(shuttingDown)return;shuttingDown=true;clearInterval(pruner);
  console.log(JSON.stringify({event:'direct_plugin_shutdown',signal}));
  server.closeIdleConnections?.();
  mtlsServer?.closeIdleConnections?.();
  mtlsServer?.close();
  const deadline=setTimeout(()=>{
    server.closeAllConnections?.();
    mtlsServer?.closeAllConnections?.();
    process.exit(0);
  },4000);
  deadline.unref();
  server.close(async()=>{
    clearTimeout(deadline);
    await goldPluginStates.flush().catch(error=>console.error('[support-outbox-flush]',error?.message));
    await flushSiteAnalytics().catch(error=>console.error('[analytics-flush]',error?.message));
    goldPluginLease.release();
    await goldStorage.close().catch(error=>console.error('[gold-db-close]',error?.message));
    process.exit(0);
  });
}
process.once('SIGTERM',()=>shutdown('SIGTERM'));
process.once('SIGINT',()=>shutdown('SIGINT'));
