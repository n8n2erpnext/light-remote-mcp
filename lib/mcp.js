const MCP_URL = process.env.VPS_MCP_URL || 'https://mcp.dashboard.thaiduy.store/mcp';
const MCP_AUDIENCE = process.env.VPS_MCP_AUDIENCE || 'https://mcp.dashboard.thaiduy.store';

async function getOidcToken() {
  const { getVercelOidcToken } = await import('@vercel/oidc');
  const token = await getVercelOidcToken({ audience: MCP_AUDIENCE });
  if (!token) throw new Error('Vercel OIDC token unavailable');
  return token;
}

async function callMcpTool(name, args = {}) {
  const token = await getOidcToken();
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args }
    }),
    signal: AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

  if (!response.ok) {
    const error = new Error(`Upstream MCP HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

module.exports = { callMcpTool };
