import crypto from 'node:crypto';
import fs from 'node:fs';

const DEFAULT_CONFIG = '/run/secrets/wall-auth.json';
const COOKIE = '__Host-gpt_operator_wall';
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function b64url(value) { return Buffer.from(value).toString('base64url'); }
function fromB64url(value) { return Buffer.from(String(value), 'base64url').toString('utf8'); }
function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function loadConfig(file = process.env.WALL_AUTH_CONFIG_FILE || DEFAULT_CONFIG) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.mode !== 'local') throw new Error('unsupported_wall_auth_mode');
  if (!config.username || !config.passwordHash || !config.cookieSecret) throw new Error('invalid_wall_auth_config');
  const ttl = Math.max(300, Math.min(Number(config.sessionTtlSeconds) || 43200, 7 * 24 * 3600));
  return { ...config, sessionTtlSeconds: ttl };
}
export function hashWallPassword(password, salt = crypto.randomBytes(16)) {
  const value = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${Buffer.from(salt).toString('base64url')}$${value.toString('base64url')}`;
}
function verifyPassword(password, encoded) {
  const [kind, saltB64, hashB64] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  if (expected.length < 16 || expected.length > 128) return false;
  const actual = crypto.scryptSync(String(password || ''), Buffer.from(saltB64, 'base64url'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
function signSession(secret, username, expiresAt) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const body = `v1.${b64url(username)}.${expiresAt}.${nonce}`;
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifySession(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const body = parts.slice(0, 4).join('.');
  const expected = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(body).digest('base64url');
  if (!safeEqual(expected, parts[4])) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  let username;
  try { username = fromB64url(parts[1]); } catch { return null; }
  return { username, expiresAt };
}
function sessionCookie(token, ttlSeconds) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Strict; Priority=High`;
}
function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict; Priority=High`;
}
function loginHtml(message = '') {
  const note = message ? `<div class="err">${message}</div>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GPT VPS Operator Wall — Login</title><style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#080a0c;color:#d8dee7}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0c}.card{width:min(420px,calc(100vw - 32px));border:1px solid #252d36;border-radius:12px;background:#0a0e12;padding:22px}.muted{color:#718096}.err{margin:12px 0;color:#ff9b9b}label{display:block;margin-top:14px}input,button{width:100%;margin-top:6px;border:1px solid #2b333d;background:#0e1216;color:#d8dee7;border-radius:7px;padding:10px;font:inherit}button{cursor:pointer;margin-top:18px}</style></head><body><main class="card"><h1 style="font-size:19px;margin:0">GPT VPS Operator Wall</h1><p class="muted">Independent operator authentication</p>${note}<form method="post" action="/auth/login"><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
}
export function createWallAuth(options = {}) {
  const config = loadConfig(options.configFile);
  const failures = new Map();
  const identity = req => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const value = verifySession(config.cookieSecret, token);
    return value && safeEqual(value.username, config.username) ? value : null;
  };
  const attemptKey = req => `${req.ip || req.socket.remoteAddress || 'unknown'}|${config.username}`;
  function recentFailures(key, now = Date.now()) {
    const values = (failures.get(key) || []).filter(at => now - at < LOGIN_WINDOW_MS);
    if (values.length) failures.set(key, values); else failures.delete(key);
    return values;
  }
  function setLoginSecurity(res) {
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  }
  function requirePage(req, res, next) {
    const value = identity(req);
    if (!value) return res.redirect(303, '/login');
    req.wallIdentity = value; return next();
  }
  function requireApi(req, res, next) {
    const value = identity(req);
    if (!value) return res.status(401).json({ ok:false, error:'wall_auth_required' });
    req.wallIdentity = value; return next();
  }
  function loginPage(req, res) {
    if (identity(req)) return res.redirect(303, '/');
    setLoginSecurity(res); return res.status(200).type('html').send(loginHtml());
  }
  function login(req, res) {
    const key = attemptKey(req), now = Date.now(), history = recentFailures(key, now);
    if (history.length >= LOGIN_MAX_ATTEMPTS) {
      const retry = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - history[0])) / 1000));
      res.set('Retry-After', String(retry)); setLoginSecurity(res);
      return res.status(429).type('html').send(loginHtml('Too many failed attempts. Try again later.'));
    }
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    const ok = safeEqual(username, config.username) && verifyPassword(password, config.passwordHash);
    if (!ok) {
      history.push(now); failures.set(key, history); setLoginSecurity(res);
      return res.status(401).type('html').send(loginHtml('Invalid username or password.'));
    }
    failures.delete(key);
    const expiresAt = Date.now() + config.sessionTtlSeconds * 1000;
    res.set('Set-Cookie', sessionCookie(signSession(config.cookieSecret, config.username, expiresAt), config.sessionTtlSeconds));
    return res.redirect(303, '/');
  }
  function logout(_req, res) {
    res.set('Set-Cookie', clearCookie());
    return res.redirect(303, '/login');
  }
  return { loginPage, login, logout, requirePage, requireApi, identity,
    info: () => ({ mode:config.mode, username:config.username, sessionTtlSeconds:config.sessionTtlSeconds }) };
}
