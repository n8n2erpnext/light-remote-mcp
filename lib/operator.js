const { sealOperatorPayload } = require('./operator-crypto');
function env(name) {
  try { const value = globalThis.Netlify?.env?.get?.(name); if (value) return value; } catch {}
  return process.env[name] || '';
}
const MCP_BASE = env('LIGHT_REMOTE_N_BASE') || 'https://nmcp.dashboard.thaiduy.store';
function bridgeAuthHeaders() {
  const secret = env('LIGHT_REMOTE_N_BRIDGE_SECRET');
  if (!secret) throw new Error('netlify_bridge_secret_unavailable');
  return { 'x-light-netlify-bridge': secret };
}
async function callOperator(path, { method = 'GET', body = null, timeoutMs = 9000, bridgeSession = '', plusSession = '', plusClient = '', accountSession = '' } = {}) {
  const headers = { accept: 'application/json', ...bridgeAuthHeaders() };
  if (bridgeSession) headers['x-bridge-session'] = bridgeSession;
  if (plusSession) headers['x-plus-session'] = plusSession;
  if (plusClient) headers['x-light-client'] = plusClient;
  if (accountSession) headers['x-light-account-session'] = accountSession;
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
