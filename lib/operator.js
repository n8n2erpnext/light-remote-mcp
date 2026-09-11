const { sealOperatorPayload } = require('./operator-crypto');
const MCP_BASE = process.env.VPS_MCP_BASE || 'https://mcp.dashboard.thaiduy.store';
const MCP_AUDIENCE = process.env.VPS_MCP_AUDIENCE || 'https://mcp.dashboard.thaiduy.store';
async function getOidcToken() {
  const { getVercelOidcToken } = await import('@vercel/oidc');
  const token = await getVercelOidcToken({ audience: MCP_AUDIENCE });
  if (!token) throw new Error('vercel_oidc_unavailable');
  return token;
}
async function callOperator(path, { method = 'GET', body = null, timeoutMs = 9000, bridgeSession = '', plusSession = '', plusClient = '' } = {}) {
  const token = await getOidcToken();
  const headers = { accept: 'application/json', authorization: `Bearer ${token}` };
  if (bridgeSession) headers['x-bridge-session'] = bridgeSession;
  if (plusSession) headers['x-plus-session'] = plusSession;
  if (plusClient) headers['x-light-client'] = plusClient;
  if (body != null) headers['content-type'] = 'application/json';
  const response = await fetch(`${MCP_BASE}${path}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let payload; try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) { const err = new Error(`operator_http_${response.status}`); err.status = response.status; err.payload = payload; throw err; }
  return payload;
}
async function execOperator(payload, { bridgeSession = '' } = {}) { return callOperator('/operator', { method: 'POST', body: sealOperatorPayload(payload), timeoutMs: 9500, bridgeSession }); }
module.exports = { callOperator, execOperator };
