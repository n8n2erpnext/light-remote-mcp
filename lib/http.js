const { callMcpTool } = require('./mcp');
const { callOperator } = require('./operator');

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
function sessionContext(req) {
  const sid = String(first(req.query.sid, '')).trim();
  const aid = String(first(req.query.aid, '')).trim();
  if (!!sid !== !!aid) throw new Error('session_context_incomplete');
  if (sid && !/^[A-Za-z0-9._:-]{1,128}$/.test(sid)) throw new Error('invalid_session_id');
  if (aid && !/^[A-Za-z0-9._:-]{16,128}$/.test(aid)) throw new Error('invalid_agent_id');
  return { sid, aid, tracked:Boolean(sid && aid) };
}
async function touchSession(ctx, tool) {
  if (!ctx.tracked) return null;
  return callOperator(`/operator/sessions/${encodeURIComponent(ctx.sid)}/touch`, { method:'POST', body:{ agentId:ctx.aid, action:`read:${tool}` } });
}
async function runReadTool(req, res, name, args = {}) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow,noarchive');
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  const started=Date.now();
  try {
    const ctx = sessionContext(req);
    if (ctx.tracked) await touchSession(ctx, name);
    const upstream = await callMcpTool(name, args);
    console.log(JSON.stringify({event:'read_bridge',tool:name,sessionId:ctx.sid||null,agentId:ctx.aid||null,status:200,durationMs:Date.now()-started}));
    return res.status(200).json({ ok:true, bridge:'vercel', tool:name, sessionTracked:ctx.tracked, sessionId:ctx.sid || null, upstream });
  } catch (error) {
    const status = error.status || (['session_context_incomplete','invalid_session_id','invalid_agent_id'].includes(error.message) ? 400 : 502);
    console.warn(JSON.stringify({event:'read_bridge',tool:name,status,error:error.message,durationMs:Date.now()-started}));
    return res.status(status).json({ ok:false, error:error.message, upstream:error.payload || null, upstreamStatus:error.status || null });
  }
}
module.exports = { first, intParam, boolParam, sessionContext, runReadTool };
