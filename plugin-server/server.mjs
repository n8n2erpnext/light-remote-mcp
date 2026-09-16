import crypto from 'node:crypto';
import fs from 'node:fs';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { callOperatorJson } from '../gateway/operator-proxy.mjs';
import { runtimeVersion } from '../lib/runtime-version.mjs';
import { INTERNAL_ALLOWED_IP, INTERNAL_HOST, INTERNAL_PORT, OPENAI_CHALLENGE_FILE, PUBLIC_ALLOWED_HOSTS, PUBLIC_HOST, PUBLIC_ORIGIN, PUBLIC_PORT } from './config.mjs';
import { authenticateAccess, registerOAuth } from './oauth.mjs';
import { pruneHostedAccountState, registerHostedAccountRoutes } from './account-hosted.mjs';
import { prunePublicDeviceRateState, registerPublicDeviceRoutes } from './device-public.mjs';
import { PUBLIC_PAGE_BODIES } from './public-pages.mjs';
import { PLUGIN_TOOL_SECURITY, registerPluginTools } from './tools.mjs';
import { installOpenAiToolSecurityCompat } from './openai-security-compat.mjs';

const VERSION=runtimeVersion({envNames:['LIGHT_REMOTE_VERSION']});
const INSTRUCTIONS='Use light_remote_list_devices before choosing a target. Keep each durable session bound to one explicit device and never silently switch targets. Prefer structured file/process tools over generic command execution, and use the PTY/ConPTY terminal only for genuinely interactive software. If an operation returns a running job, read job/output instead of repeating the action. Never request, reveal, echo, or transmit passwords, API keys, MFA/OTP codes, private keys, or other authentication secrets; use local credential stores without exposing secret values. Device-local policy is authoritative; explain denials rather than attempting to bypass them.';
const publicApp=createMcpExpressApp({host:PUBLIC_HOST,allowedHosts:PUBLIC_ALLOWED_HOSTS});
publicApp.disable('x-powered-by');
publicApp.set('trust proxy','loopback, linklocal, uniquelocal');
publicApp.use((_req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('Cache-Control','no-store');res.set('X-Robots-Tag','noindex, nofollow, noarchive');res.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');next();});
registerOAuth(publicApp);
registerHostedAccountRoutes(publicApp);
registerPublicDeviceRoutes(publicApp);
const publicStatePruner=setInterval(()=>{pruneHostedAccountState();prunePublicDeviceRateState();},60_000);
publicStatePruner.unref?.();

function html(title,body){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;max-width:820px;margin:48px auto;padding:0 20px;line-height:1.6;color:#1f2937}h1,h2{line-height:1.2}code{background:#f3f4f6;padding:2px 5px;border-radius:4px}a{color:#1d4ed8}</style></head><body>${body}</body></html>`;}
publicApp.get('/',(_q,r)=>r.type('html').send(html('Light Remote',PUBLIC_PAGE_BODIES.home)));
publicApp.get('/support',(_q,r)=>r.type('html').send(html('Light Remote Support',PUBLIC_PAGE_BODIES.support)));
publicApp.get('/privacy',(_q,r)=>r.type('html').send(html('Light Remote Privacy Policy',PUBLIC_PAGE_BODIES.privacy)));
publicApp.get('/terms',(_q,r)=>r.type('html').send(html('Light Remote Terms of Service',PUBLIC_PAGE_BODIES.terms)));
publicApp.get('/healthz',(_q,r)=>r.json({ok:true,service:'light-remote-plugin',version:VERSION}));
publicApp.get('/.well-known/openai-apps-challenge',(_q,r)=>{try{const token=fs.readFileSync(OPENAI_CHALLENGE_FILE,'utf8').trim();if(!token)return r.sendStatus(404);return r.type('text/plain').send(token);}catch{return r.sendStatus(404);}});

function mcpServer(identity){const server=new McpServer({name:'light-remote',version:VERSION},{instructions:INSTRUCTIONS});registerPluginTools(server,identity);installOpenAiToolSecurityCompat(server,PLUGIN_TOOL_SECURITY);return server;}
publicApp.post('/mcp',async(req,res)=>{const {identity}=await authenticateAccess(req);const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true}),server=mcpServer(identity);try{await server.connect(transport);await transport.handleRequest(req,res,req.body);}catch(error){console.error('[plugin-mcp]',error?.message||error);if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',error:{code:-32603,message:'Internal error'},id:req.body?.id??null});}finally{await transport.close().catch(()=>{});await server.close().catch(()=>{});}});
for(const method of ['get','delete'])publicApp[method]('/mcp',(_q,r)=>r.status(405).json({jsonrpc:'2.0',error:{code:-32000,message:'Method not allowed'},id:null}));

const internal=express();internal.disable('x-powered-by');internal.use(express.json({limit:'2mb'}));
const normalizedIp=req=>String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
internal.use((req,res,next)=>normalizedIp(req)===INTERNAL_ALLOWED_IP?next():res.status(403).json({ok:false,error:'internal_device_source_denied'}));
internal.get('/healthz',(_q,r)=>r.json({ok:true,service:'light-remote-plugin-device-bridge'}));
internal.post('/api/operator',async(req,res)=>{try{const action=String(req.body?.action||''),p=req.body?.payload||{};let upstream;if(action==='enrollment-begin'){const sourceHash=crypto.createHash('sha256').update(normalizedIp(req)).digest('hex');upstream=await callOperatorJson('POST','/v1/enrollments/begin',{...p,sourceHash});}else if(action==='enrollment-poll')upstream=await callOperatorJson('POST','/v1/enrollments/poll',p);else if(action==='device-heartbeat'){if(!p.deviceId)throw new Error('device_id_required');upstream=await callOperatorJson('POST',`/v1/devices/${encodeURIComponent(p.deviceId)}/heartbeat`,p);}else return res.status(403).json({ok:false,error:'internal_operator_action_denied'});return res.json({ok:true,upstream});}catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'internal_operator_failed'});}});
const channelActions=new Set(['connect','disconnect','grace','account-auth','fleet-intent','fleet-authority','fleet-status','fleet-devices','fleet-sessions','fleet-activity','fleet-device-policy','fleet-device-update','pairing-code','account-owner-proof','access-approve','access-deny','status','activity','update-report','poll','result']);
internal.post('/device-channel/:action',async(req,res)=>{const action=String(req.params.action||'');if(!channelActions.has(action))return res.status(404).json({ok:false,error:'device_channel_action_denied'});try{return res.json(await callOperatorJson('POST',`/v1/device-channel/${encodeURIComponent(action)}`,req.body||{}));}catch(error){return res.status(Number(error.status)||400).json({ok:false,error:error.message||'device_channel_failed'});}});

const publicServer=publicApp.listen(PUBLIC_PORT,PUBLIC_HOST,()=>console.log(JSON.stringify({event:'plugin_public_listen',origin:PUBLIC_ORIGIN,host:PUBLIC_HOST,port:PUBLIC_PORT})));
const internalServer=internal.listen(INTERNAL_PORT,INTERNAL_HOST,()=>console.log(JSON.stringify({event:'plugin_internal_listen',host:INTERNAL_HOST,port:INTERNAL_PORT,allowedIp:INTERNAL_ALLOWED_IP})));
function shutdown(){clearInterval(publicStatePruner);let pending=2;const done=()=>{if(--pending<=0)process.exit(0)};publicServer.close(done);internalServer.close(done);setTimeout(()=>process.exit(1),5000).unref();}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
