import os from 'node:os';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { recordActivity, recentActivity, attachActivitySse } from './activity.mjs';
import { dashboardHtml } from './dashboard.mjs';
import { enrollmentApprovalHtml } from './enrollment-page.mjs';
import { createWallAuth } from './wall-auth.mjs';
import { authenticateVercel, isToolCall, requireVercelForToolCall, securityInfo } from './security.mjs';
import { proxyOperatorJson, proxyOperatorSse } from './operator-proxy.mjs';
import { rootNames, listWorkspace, readWorkspaceText, searchWorkspace, gitStatus, gitDiff } from './workspace.mjs';

const PORT = Number(process.env.PORT || 8080);
const WALL_PORT = Number(process.env.WALL_PORT || 8081);
const OPERATOR_ACCOUNT_ID = String(process.env.OPERATOR_ACCOUNT_ID || 'self-hosted-local');
const VERSION = '0.7.0-dev';
const RootSchema = z.enum(['n8n2erpnext', 'services', 'thaiduy', 'frappe']);

function textResult(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function tracked(name, identity, fn) {
  return async args => {
    const started = Date.now();
    const caller = identity?.project ? `vercel:${identity.project}` : 'public-discovery';
    recordActivity({ kind: 'tool', tool: name, status: 'running', caller });
    try {
      const result = await fn(args || {});
      recordActivity({ kind: 'tool', tool: name, status: 'ok', caller, durationMs: Date.now() - started });
      return textResult(result);
    } catch (error) {
      recordActivity({ kind: 'tool', tool: name, status: 'error', caller, durationMs: Date.now() - started, detail: error.message });
      return { ...textResult({ error: error.message }), isError: true };
    }
  };
}
function getServer(identity) {
  const server = new McpServer({ name: 'thaiduy-vps-arm-mcp', version: VERSION });
  const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool('ping', {
    title: 'Ping VPS ARM', description: 'Read-only connectivity proof.', annotations: { title: 'Ping VPS ARM', ...ro }
  }, tracked('ping', identity, async () => `pong ${new Date().toISOString()}`));

  server.registerTool('vps_identity', {
    title: 'VPS ARM Identity', description: 'Return non-sensitive runtime identity.', annotations: { title: 'VPS ARM Identity', ...ro }
  }, tracked('vps_identity', identity, async () => ({
    hostname: os.hostname(), platform: os.platform(), arch: os.arch(), uptimeSeconds: Math.floor(os.uptime())
  })));

  server.registerTool('system_status', {
    title: 'System Status', description: 'Read safe system load and memory status.', annotations: { title: 'System Status', ...ro }
  }, tracked('system_status', identity, async () => ({
    hostname: os.hostname(), arch: os.arch(), uptimeSeconds: Math.floor(os.uptime()), loadavg: os.loadavg(),
    totalMemory: os.totalmem(), freeMemory: os.freemem(), cpuCount: os.cpus().length
  })));

  server.registerTool('workspace_roots', {
    title: 'Workspace Roots', description: 'List read-only workspace aliases available to this MCP.', annotations: { title: 'Workspace Roots', ...ro }
  }, tracked('workspace_roots', identity, async () => ({ roots: rootNames() })));
  server.registerTool('fs_list', {
    title: 'List Workspace',
    description: 'List files and directories in an allowed read-only workspace.',
    inputSchema: {
      root: RootSchema,
      path: z.string().optional(),
      depth: z.number().int().min(1).max(3).optional()
    },
    annotations: { title: 'List Workspace', ...ro }
  }, tracked('fs_list', identity, async ({ root, path = '.', depth = 1 }) => ({
    root, path, entries: await listWorkspace(root, path, depth)
  })));

  server.registerTool('fs_read_text', {
    title: 'Read Text File',
    description: 'Read a bounded slice of a non-sensitive text file from an allowed workspace.',
    inputSchema: {
      root: RootSchema,
      path: z.string().min(1),
      startLine: z.number().int().min(1).optional(),
      maxLines: z.number().int().min(1).max(400).optional()
    },
    annotations: { title: 'Read Text File', ...ro }
  }, tracked('fs_read_text', identity, async ({ root, path, startLine = 1, maxLines = 200 }) =>
    readWorkspaceText(root, path, startLine, maxLines)));

  server.registerTool('fs_search', {
    title: 'Search Workspace',
    description: 'Literal case-insensitive search across bounded non-sensitive text files.',
    inputSchema: {
      root: RootSchema,
      path: z.string().optional(),
      query: z.string().min(2),
      maxResults: z.number().int().min(1).max(80).optional()
    },
    annotations: { title: 'Search Workspace', ...ro }
  }, tracked('fs_search', identity, async ({ root, path = '.', query, maxResults = 40 }) =>
    searchWorkspace(root, path, query, maxResults)));

  server.registerTool('git_status', {
    title: 'Git Status',
    description: 'Read git branch and working-tree status for a repository under an allowed workspace.',
    inputSchema: { root: RootSchema, repoPath: z.string().optional() },
    annotations: { title: 'Git Status', ...ro }
  }, tracked('git_status', identity, async ({ root, repoPath = '.' }) => gitStatus(root, repoPath)));

  server.registerTool('git_diff', {
    title: 'Git Diff',
    description: 'Read a bounded non-mutating git diff from an allowed repository.',
    inputSchema: {
      root: RootSchema, repoPath: z.string().optional(), path: z.string().optional(), cached: z.boolean().optional()
    },
    annotations: { title: 'Git Diff', ...ro }
  }, tracked('git_diff', identity, async ({ root, repoPath = '.', path = '', cached = false }) =>
    gitDiff(root, repoPath, path, cached)));

  return server;
}
const app = createMcpExpressApp({
  host: '0.0.0.0',
  allowedHosts: [
    'mcp.dashboard.thaiduy.store',
    'lightbi-mcp-poc', 'lightbi-mcp-poc:8080',
    '100.94.184.141', '100.94.184.141:5488', 'localhost:8080', '127.0.0.1:8080'
  ]
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
});

const rateBuckets = new Map();
function softRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now(), minute = Math.floor(now / 60000);
  const current = rateBuckets.get(key);
  const state = current?.minute === minute ? current : { minute, count: 0 };
  state.count++; rateBuckets.set(key, state);
  if (state.count > 600) return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: 60 - Math.floor((now % 60000) / 1000) });
  next();
}
const wallAuth = createWallAuth();
app.get('/healthz', (_req, res) => res.json({
  ok: true, service: 'thaiduy-vps-arm-mcp', version: VERSION, mode: 'read-plus-operator', security: { ...securityInfo(), bridgeSession:'required-for-tool-and-operator-calls', bridgeSessionTtlSeconds:wallAuth.info().bridgeSessionTtlSeconds }
}));

async function requireVercelIdentity(req, res, next) {
  try { req.mcpIdentity = await authenticateVercel(req); return next(); }
  catch { return res.status(401).json({ ok: false, error: 'unauthorized_operator_call' }); }
}
async function requireOperatorIdentity(req, res, next) {
  try { req.mcpIdentity = await authenticateVercel(req); }
  catch { return res.status(401).json({ ok: false, error: 'unauthorized_operator_call' }); }
  return wallAuth.requireBridgeSession(req, res, next);
}
function requireBridgeForToolCall(req, res, next) {
  if (!isToolCall(req)) return next();
  const identity = wallAuth.bridgeIdentity(req);
  if (identity) { req.bridgeIdentity = identity; return next(); }
  res.set('Cache-Control', 'no-store');
  return res.status(401).json({ jsonrpc:'2.0', error:{ code:-32002, message:'Bridge session required' }, id:req.body?.id ?? null });
}

app.post('/operator/auth/login', softRateLimit, requireVercelIdentity, wallAuth.bridgeLogin);
app.post('/operator/enrollments/begin', softRateLimit, requireVercelIdentity, (req, res) => proxyOperatorJson(res, 'POST', '/v1/enrollments/begin', req.body || {}));
app.post('/operator/enrollments/poll', softRateLimit, requireVercelIdentity, (req, res) => proxyOperatorJson(res, 'POST', '/v1/enrollments/poll', req.body || {}));
app.post('/operator/devices/:id/heartbeat', softRateLimit, requireVercelIdentity, (req, res) => proxyOperatorJson(res, 'POST', `/v1/devices/${encodeURIComponent(req.params.id)}/heartbeat`, req.body || {}));
app.get('/operator/enrollments', softRateLimit, requireOperatorIdentity, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/enrollments'));
app.post('/operator/enrollments/approve', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', '/v1/enrollments/approve', { ...(req.body || {}), accountId:OPERATOR_ACCOUNT_ID }));
app.post('/operator', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', '/v1/execute', req.body));
app.get('/operator/capabilities', softRateLimit, requireOperatorIdentity, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/capabilities'));
app.get('/operator/devices', softRateLimit, requireOperatorIdentity, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/devices'));
app.get('/operator/devices/:id', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'GET', `/v1/devices/${encodeURIComponent(req.params.id)}`));
app.post('/operator/devices/:id/revoke', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', `/v1/devices/${encodeURIComponent(req.params.id)}/revoke`, { deviceId:req.params.id, accountId:OPERATOR_ACCOUNT_ID, reason:String(req.body?.reason || 'owner_revoked').slice(0,120) }));
app.post('/operator/sessions/open', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', '/v1/sessions/open', req.body));
app.post('/operator/sessions/:id/touch', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', `/v1/sessions/${encodeURIComponent(req.params.id)}/touch`, req.body || {}));
app.get('/operator/sessions', softRateLimit, requireOperatorIdentity, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/sessions'));
app.get('/operator/session-stats', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'GET', `/v1/session-stats?hours=${encodeURIComponent(req.query.hours || '168')}`));
app.get('/operator/sessions/:id', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'GET', `/v1/sessions/${encodeURIComponent(req.params.id)}?agentId=${encodeURIComponent(req.query.agentId || '')}`));
app.post('/operator/sessions/:id/resume', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', `/v1/sessions/${encodeURIComponent(req.params.id)}/resume`, req.body || {}));
app.post('/operator/sessions/:id/close', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'POST', `/v1/sessions/${encodeURIComponent(req.params.id)}/close`, req.body || {}));
app.get('/operator/jobs/:id', softRateLimit, requireOperatorIdentity, (req, res) => proxyOperatorJson(res, 'GET', `/v1/jobs/${encodeURIComponent(req.params.id)}?agentId=${encodeURIComponent(req.query.agentId || '')}`));
app.get('/operator/output/:id', softRateLimit, requireOperatorIdentity, (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return proxyOperatorJson(res, 'GET', `/v1/output/${encodeURIComponent(req.params.id)}${qs ? `?${qs}` : ''}`);
});

app.post('/mcp', softRateLimit, requireVercelForToolCall, requireBridgeForToolCall, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  const server = getServer(req.mcpIdentity);
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcp] request failed', error?.message || error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: req.body?.id ?? null });
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

for (const method of ['get', 'delete']) app[method]('/mcp', (_req, res) => res.status(405).json({
  jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null
}));


const wallApp = express();
wallApp.disable('x-powered-by');
wallApp.set('trust proxy', 'loopback, linklocal, uniquelocal');
wallApp.use(express.urlencoded({ extended:false, limit:'4kb' }));
wallApp.use(express.json({ limit:'16kb' }));
wallApp.use((_req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
});
wallApp.get('/login', wallAuth.loginPage);
wallApp.post('/auth/login', wallAuth.login);
wallApp.post('/auth/logout', wallAuth.logout);
wallApp.get('/enroll', wallAuth.requirePage, (req, res) => {
  const enrollmentId = String(req.query.id || '').replace(/[^A-Za-z0-9._:-]/g,'').slice(0,128);
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.type('html').send(enrollmentApprovalHtml(enrollmentId));
});
wallApp.get('/', wallAuth.requirePage, (_req, res) => {
  res.set('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.type('html').send(dashboardHtml());
});
wallApp.get('/api/devices', wallAuth.requireApi, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/devices'));
wallApp.get('/api/enrollments', wallAuth.requireApi, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/enrollments'));
wallApp.post('/api/enrollments/approve', wallAuth.requireApi, (req, res) => proxyOperatorJson(res, 'POST', '/v1/enrollments/approve', { ...(req.body || {}), accountId:OPERATOR_ACCOUNT_ID }));
wallApp.get('/api/sessions', wallAuth.requireApi, (_req, res) => proxyOperatorJson(res, 'GET', '/v1/sessions'));
wallApp.get('/api/activity', wallAuth.requireApi, (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 1000, 5000));
  return proxyOperatorJson(res, 'GET', `/v1/activity?limit=${limit}`);
});
wallApp.get('/events', wallAuth.requireApi, proxyOperatorSse);
wallApp.use((_req, res) => res.status(404).end());

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`thaiduy-vps-arm-mcp v${VERSION} listening on ${PORT}`);
});
const wallServer = wallApp.listen(WALL_PORT, '0.0.0.0', () => {
  console.log(`thaiduy-vps-arm-wall v${VERSION} listening on ${WALL_PORT}`);
});

function shutdown(signal) {
  console.log(`[mcp] ${signal}, shutting down`);
  let pending = 2;
  const done = () => { if (--pending === 0) process.exit(0); };
  httpServer.close(done);
  wallServer.close(done);
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
