import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';

const TEAM_SLUG = process.env.VERCEL_TEAM_SLUG || 'thdangduys-projects';
const PROJECT_NAME = process.env.VERCEL_PROJECT_NAME || 'light-remote-mcp';
const AUDIENCE = process.env.VERCEL_AUDIENCE || 'https://mcp.dashboard.thaiduy.store';
const ALLOWED_ENV = process.env.VERCEL_ENVIRONMENT || 'production';
const PLUS_BRIDGE_ENV = process.env.VERCEL_PLUS_BRIDGE_ENVIRONMENT || 'preview';
const TEAM_ISSUER = `https://oidc.vercel.com/${TEAM_SLUG}`;
const GLOBAL_ISSUER = 'https://oidc.vercel.com';
const expectedSubject = environment => `owner:${TEAM_SLUG}:project:${PROJECT_NAME}:environment:${environment}`;
const EXPECTED_SUBJECT = expectedSubject(ALLOWED_ENV);
const JWKS = createRemoteJWKSet(new URL('https://oidc.vercel.com/.well-known/jwks'));

function bearer(req) {
  const value = req.get('authorization') || '';
  return value.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

export function isToolCall(req) {
  return req.body?.method === 'tools/call';
}

async function authenticateVercelEnvironment(req, environment) {
  const token = bearer(req);
  if (!token) throw new Error('missing_bearer');
  const preview = decodeJwt(token);
  if (![TEAM_ISSUER, GLOBAL_ISSUER].includes(preview.iss)) throw new Error('issuer_not_allowed');
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: preview.iss,
    audience: AUDIENCE,
    subject: expectedSubject(environment)
  });
  return { issuer:payload.iss, subject:payload.sub, project:PROJECT_NAME, environment };
}

export async function authenticateVercel(req) {
  return authenticateVercelEnvironment(req, ALLOWED_ENV);
}

export async function authenticateVercelPlusBridge(req) {
  return authenticateVercelEnvironment(req, PLUS_BRIDGE_ENV);
}

export async function requireVercelForToolCall(req, res, next) {
  if (!isToolCall(req)) return next();
  try {
    req.mcpIdentity = await authenticateVercel(req);
    return next();
  } catch (error) {
    res.set('Cache-Control', 'no-store');
    return res.status(401).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized MCP tool call' },
      id: req.body?.id ?? null
    });
  }
}

export function securityInfo() {
  return {
    toolCalls: 'vercel-oidc-required',
    discovery: 'public',
    audience: AUDIENCE,
    project: PROJECT_NAME,
    environment: ALLOWED_ENV,
    plusBridgeEnvironment: PLUS_BRIDGE_ENV
  };
}
