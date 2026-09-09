const crypto = require('node:crypto');

function bearer(req) {
  const raw = String(req?.headers?.authorization || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function sameSecret(left, right) {
  const a = crypto.createHash('sha256').update(String(left)).digest();
  const b = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(a, b);
}

function isBridgeCallerAuthorized(req) {
  const expected = String(process.env.VPS_BRIDGE_CALLER_SECRET || '').trim();
  if (expected.length < 32) return false;
  const provided = bearer(req);
  if (!provided) return false;
  return sameSecret(provided, expected);
}

function requireBridgeCaller(req, res) {
  if (isBridgeCallerAuthorized(req)) return true;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.status(401).json({ ok:false, error:'bridge_caller_auth_required' });
  return false;
}

module.exports = { isBridgeCallerAuthorized, requireBridgeCaller };
