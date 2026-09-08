const { callMcpTool } = require('./mcp');

function first(value, fallback = '') {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}
function intParam(value, fallback, min, max) {
  const n = Number.parseInt(first(value, fallback), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
function boolParam(value) {
  return ['1','true','yes','on'].includes(String(first(value, '')).toLowerCase());
}
async function runReadTool(req, res, name, args = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  try {
    const upstream = await callMcpTool(name, args);
    return res.status(200).json({ ok:true, bridge:'vercel', tool:name, upstream });
  } catch (error) {
    return res.status(502).json({ ok:false, error:error.message, upstreamStatus:error.status || null });
  }
}
module.exports = { first, intParam, boolParam, runReadTool };
