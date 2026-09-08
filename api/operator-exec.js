const { execOperator } = require('../lib/operator');
function decodePayload(value) {
  if (!value) throw new Error('missing_payload');
  const raw = Buffer.from(String(value), 'base64url').toString('utf8');
  const data = JSON.parse(raw);
  if (typeof data.script !== 'string' || !data.script.trim()) throw new Error('invalid_script');
  return {
    action: 'exec_batch', script: data.script, cwd: data.cwd || '/home/ubuntu',
    timeoutMs: Math.max(1000, Math.min(Number(data.timeoutMs) || 600000, 7200000)),
    waitMs: Math.max(0, Math.min(Number(data.waitMs) || 7000, 7000)),
    sessionId: String(data.sessionId || 'chatgpt'), note: String(data.note || '')
  };
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store'); res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
  if (req.method !== 'GET') return res.status(405).json({ok:false,error:'method_not_allowed'});
  try { const payload = decodePayload(req.query.p); const upstream = await execOperator(payload); return res.status(200).json({ok:true,bridge:'vercel',upstream}); }
  catch (e) { return res.status(e.status || 400).json({ok:false,error:e.message,upstream:e.payload || null}); }
};
