const { callMcpTool } = require('../lib/mcp');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const upstream = await callMcpTool('ping');
    return res.status(200).json({
      ok: true,
      bridge: 'vercel',
      tool: 'ping',
      upstream
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error.message,
      upstreamStatus: error.status || null
    });
  }
};
