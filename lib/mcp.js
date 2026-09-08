const MCP_URL = process.env.VPS_MCP_URL || 'https://lightbi.app/remote-mcp/mcp';

async function callMcpTool(name, args = {}) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args }
    }),
    signal: AbortSignal.timeout(8000)
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
