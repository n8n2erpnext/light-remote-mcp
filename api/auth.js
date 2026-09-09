const { callOperator } = require('../lib/operator');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'method_not_allowed' });
  const username = String(req.body?.username || '');
  const password = String(req.body?.password || '');
  if (!username || username.length > 128 || !password || password.length > 1024) {
    return res.status(400).json({ ok:false, error:'invalid_login_payload' });
  }
  try {
    const upstream = await callOperator('/operator/auth/login', {
      method:'POST', body:{ username, password }, timeoutMs:9000
    });
    return res.status(200).json({ ok:true, session:upstream.session });
  } catch (error) {
    const status = error.status || 502;
    return res.status(status).json({ ok:false, error:error.payload?.error || error.message });
  }
};
