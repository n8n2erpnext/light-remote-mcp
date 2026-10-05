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
import { PUBLIC_PAGE_BODIES } from './public-pages.mjs';
import { PLUGIN_TOOL_SECURITY, registerPluginTools } from './tools.mjs';
import { installOpenAiToolSecurityCompat } from './openai-security-compat.mjs';
import { installLegacyToolCallCompat } from './legacy-tool-call-compat.mjs';
import { WEB_FONT_FACE_CSS, WEB_UI_FONT, WEB_CODE_FONT } from '../lib/web-typography.mjs';

const INSTRUCTIONS='OAuth authenticates the account; Local Wall A/B approval authorizes each exact device. For an unpaired target, use light_remote_connection_helper with the owner-provided A code, show only the returned B code, wait for approval at that same Local Wall, then continue with the returned continuation. Keep device and session targets explicit and never silently switch them. Use each focused tool directly for its named action. Device-local policy is final authority. Never request, reveal, echo, or transmit passwords, MFA/OTP codes, API keys, private keys, bearer tokens, continuations, or other authentication secrets. The MCP cannot mint an A code or bypass Local Wall /approve.';

const app=createMcpExpressApp({host:PUBLIC_HOST,allowedHosts:PUBLIC_ALLOWED_HOSTS});
app.disable('x-powered-by');
app.set('trust proxy','loopback, linklocal, uniquelocal');
app.use(express.json({limit:'12mb'}));
app.use(express.urlencoded({extended:false,limit:'128kb'}));
app.use((_req,res,next)=>{
  res.set('X-Content-Type-Options','nosniff');
  res.set('Referrer-Policy','no-referrer');
  res.set('Cache-Control','no-store');
  res.set('X-Robots-Tag','noindex, nofollow, noarchive');
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

function html(title,body){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${WEB_FONT_FACE_CSS}body{font-family:${WEB_UI_FONT};font-size:16px;max-width:820px;margin:48px auto;padding:0 20px;line-height:1.6;color:#1f2937}h1,h2{line-height:1.2}code{font-family:${WEB_CODE_FONT};background:#f3f4f6;padding:2px 5px;border-radius:4px}a{color:#1d4ed8}</style></head><body>${body}</body></html>`;}
app.get('/',(_q,r)=>r.type('html').send(fs.readFileSync(new URL('./public-home.html',import.meta.url),'utf8')));
app.get('/support',(_q,r)=>r.type('html').send(html('Light Remote Support',PUBLIC_PAGE_BODIES.support)));
app.get('/privacy',(_q,r)=>r.type('html').send(html('Light Remote Privacy Policy',PUBLIC_PAGE_BODIES.privacy)));
app.get('/terms',(_q,r)=>r.type('html').send(html('Light Remote Terms of Service',PUBLIC_PAGE_BODIES.terms)));
app.get('/healthz',(_q,r)=>r.json({ok:true,service:'light-remote-direct-plugin',version:VERSION,mcpSurfaceVersion:MCP_SURFACE_VERSION,transport:'direct'}));
app.get('/.well-known/openai-apps-challenge',(_q,r)=>{
  try{const token=fs.readFileSync(OPENAI_CHALLENGE_FILE,'utf8').trim();if(!token)return r.sendStatus(404);return r.type('text/plain').send(token);}
  catch{return r.sendStatus(404);}
});

function mcpServer(identity){
  const server=new McpServer({name:'light-remote',version:MCP_SURFACE_VERSION},{instructions:INSTRUCTIONS});
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
