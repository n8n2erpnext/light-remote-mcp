import fs from 'node:fs';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { PUBLIC_ALLOWED_HOSTS, PUBLIC_HOST, PUBLIC_ORIGIN, PUBLIC_PORT, OPENAI_CHALLENGE_FILE, VERSION, MCP_SURFACE_VERSION } from './config.mjs';
import { authenticateAccess, registerOAuth } from './oauth.mjs';
import { registerPublicDeviceRoutes, prunePublicRateState } from './device-public.mjs';
import { registerAccountPortal } from './account-portal.mjs';
import { registerDistributionPortal } from './distribution-portal.mjs';
import { registerAdminPortal } from './admin-portal.mjs';
import { registerWebAssets } from './web-assets.mjs';
import { LEGAL_PAGES, renderLegalPage } from './legal-pages.mjs';
import { renderSupportPage } from './support-page.mjs';
import { PLUGIN_TOOL_SECURITY, registerPluginTools } from './tools.mjs';
import { installOpenAiToolSecurityCompat } from './openai-security-compat.mjs';
import { installLegacyToolCallCompat } from './legacy-tool-call-compat.mjs';


const app=createMcpExpressApp({host:PUBLIC_HOST,allowedHosts:PUBLIC_ALLOWED_HOSTS});
app.disable('x-powered-by');
app.set('trust proxy','loopback, linklocal, uniquelocal');
app.use(express.json({limit:'12mb'}));
app.use(express.urlencoded({extended:false,limit:'128kb'}));
const PUBLIC_INDEXABLE_PATHS=new Set(['/','/downloads','/downloads/','/support','/privacy','/terms','/cookies','/robots.txt','/sitemap.xml','/site.webmanifest','/favicon.ico']);
app.use((req,res,next)=>{
  const indexable=PUBLIC_INDEXABLE_PATHS.has(req.path);
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy',indexable?'strict-origin-when-cross-origin':'no-referrer');
  res.set('Cache-Control',indexable?'public, max-age=300':'no-store');
  if(!indexable)res.set('X-Robots-Tag','noindex, nofollow, noarchive');
  res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  next();
});

registerOAuth(app);
registerWebAssets(app);
registerAccountPortal(app);
registerDistributionPortal(app);
registerAdminPortal(app);
registerPublicDeviceRoutes(app);
const pruner=setInterval(()=>prunePublicRateState(),60_000);pruner.unref?.();

app.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(new URL('./public-home.html',import.meta.url),'utf8')));
app.get('/support',(_q,r)=>r.type('html').send(renderSupportPage({origin:PUBLIC_ORIGIN,version:VERSION})));
app.get('/privacy',(_q,r)=>r.type('html').send(renderLegalPage({active:'privacy',origin:PUBLIC_ORIGIN,...LEGAL_PAGES.privacy})));
app.get('/terms',(_q,r)=>r.type('html').send(renderLegalPage({active:'terms',origin:PUBLIC_ORIGIN,...LEGAL_PAGES.terms})));
app.get('/cookies',(_q,r)=>r.type('html').send(renderLegalPage({active:'cookies',origin:PUBLIC_ORIGIN,...LEGAL_PAGES.cookies})));
app.get('/robots.txt',(_q,r)=>r.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /oauth\nDisallow: /mcp\nDisallow: /operator\nDisallow: /.well-known/openai-apps-challenge\n\nSitemap: '+PUBLIC_ORIGIN+'/sitemap.xml\n'));
app.get('/sitemap.xml',(_q,r)=>{
  const urls=['/','/downloads','/support','/privacy','/terms','/cookies'];
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

const server=app.listen(PUBLIC_PORT,PUBLIC_HOST,()=>{
  console.log(JSON.stringify({event:'direct_plugin_listen',origin:PUBLIC_ORIGIN,host:PUBLIC_HOST,port:PUBLIC_PORT,version:VERSION}));
});
let shuttingDown=false;
function shutdown(signal){
  if(shuttingDown)return;shuttingDown=true;clearInterval(pruner);
  console.log(JSON.stringify({event:'direct_plugin_shutdown',signal}));
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),5000).unref();
}
process.once('SIGTERM',()=>shutdown('SIGTERM'));
process.once('SIGINT',()=>shutdown('SIGINT'));
