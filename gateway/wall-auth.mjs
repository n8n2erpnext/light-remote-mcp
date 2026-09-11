import crypto from 'node:crypto';
import fs from 'node:fs';
import { brandTitleSvg } from './brand.mjs';

const DEFAULT_CONFIG = '/run/secrets/wall-auth.json';
const SECURE_COOKIE = '__Host-gpt_operator_wall';
const LOCAL_COOKIE = 'gpt_operator_wall';
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const DEFAULT_BRIDGE_TTL_SECONDS = 15 * 60;

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
function signScopedToken(secret, kind, payload) {
  if (!/^[a-z0-9_-]{1,32}$/.test(String(kind || ''))) throw new Error('invalid_scoped_token_kind');
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(`scoped:${kind}:${body}`).digest('base64url');
  return `o1.${kind}.${body}.${sig}`;
}
function verifyScopedToken(secret, kind, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'o1' || parts[1] !== kind) return null;
  const expected = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(`scoped:${kind}:${parts[2]}`).digest('base64url');
  if (!safeEqual(expected, parts[3])) return null;
  let payload; try { payload = JSON.parse(fromB64url(parts[2])); } catch { return null; }
  if (payload?.exp != null && (!Number.isSafeInteger(payload.exp) || payload.exp <= Date.now())) return null;
  return payload;
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
function signBridgeSession(secret, username, expiresAt) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const body = `b1.${b64url(username)}.${expiresAt}.${nonce}`;
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(`bridge:${body}`).digest('base64url');
  return `${body}.${sig}`;
}
function verifyBridgeSession(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 5 || parts[0] !== 'b1') return null;
  const body = parts.slice(0, 4).join('.');
  const expected = crypto.createHmac('sha256', Buffer.from(secret, 'base64url')).update(`bridge:${body}`).digest('base64url');
  if (!safeEqual(expected, parts[4])) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
  let username;
  try { username = fromB64url(parts[1]); } catch { return null; }
  return { username, expiresAt, scope:'operator' };
}

function sessionCookie(name, token, ttlSeconds, secure = true) {
  return `${name}=${token}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Priority=High`;
}
function clearCookie(name, secure = true) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=Strict; Priority=High`;
}
function safeNext(value) {
  const text=String(value||'').trim();
  return text.startsWith('/') && !text.startsWith('//') && text.length <= 512 ? text : '/';
}
function loginHtml(message = '', next = '/') {
  const note = message ? `<div class="err">${message}</div>` : '';
  const nextValue=String(safeNext(next)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote MCP — Login</title><style>
:root{color-scheme:dark;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#080a0c;color:#d8dee7}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080a0c}.card{width:min(420px,calc(100vw - 32px));border:1px solid #252d36;border-radius:12px;background:#0a0e12;padding:22px}.muted{color:#718096}.brand-title{display:flex;align-items:center;gap:12px;margin-bottom:8px}.brand-title>span{display:flex;align-items:baseline;gap:7px}.brand-title strong{font-size:20px;color:#f3f4f6}.brand-title small{font-size:10px;letter-spacing:.16em;color:#718096}.brand-mark{flex:0 0 auto}.err{margin:12px 0;color:#ff9b9b}label{display:block;margin-top:14px}input,button{width:100%;margin-top:6px;border:1px solid #2b333d;background:#0e1216;color:#d8dee7;border-radius:7px;padding:10px;font:inherit}button{cursor:pointer;margin-top:18px}</style></head><body><main class="card">${brandTitleSvg(48)}<p class="muted">Independent operator authentication</p>${note}<form method="post" action="/auth/login"><input type="hidden" name="next" value="${nextValue}"><label>Username<input name="username" autocomplete="username" required autofocus></label><label>Password<input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form></main></body></html>`;
}
export function createWallAuth(options = {}) {
  const config = loadConfig(options.configFile);
  const bridgeTtlSeconds = Math.max(300, Math.min(Number(options.bridgeTtlSeconds || process.env.BRIDGE_SESSION_TTL_SECONDS) || DEFAULT_BRIDGE_TTL_SECONDS, 3600));
  const cookieSecure = options.cookieSecure ?? String(process.env.WALL_COOKIE_SECURE || 'true').toLowerCase() !== 'false';
  const cookieName = cookieSecure ? SECURE_COOKIE : LOCAL_COOKIE;
  const failures = new Map();
  const identity = req => {
    const token = parseCookies(req.headers.cookie)[cookieName];
    const value = verifySession(config.cookieSecret, token);
    return value && safeEqual(value.username, config.username) ? value : null;
  };
  const bridgeIdentity = req => {
    const token = String(req.headers?.['x-bridge-session'] || '');
    const value = verifyBridgeSession(config.cookieSecret, token);
    return value && safeEqual(value.username, config.username) ? value : null;
  };
  const credentialsOk = (username, password) => safeEqual(username, config.username) && verifyPassword(password, config.passwordHash);
  const verifyBridgeToken = token => {
    const value = verifyBridgeSession(config.cookieSecret, token);
    return value && safeEqual(value.username, config.username) ? value : null;
  };
  const signOAuthToken = (kind, payload) => signScopedToken(config.cookieSecret, kind, payload);
  const verifyOAuthToken = (kind, token) => verifyScopedToken(config.cookieSecret, kind, token);
  const mintBridgeSession = (ttlSeconds = bridgeTtlSeconds) => {
    const ttl = Math.max(300, Math.min(Number(ttlSeconds) || bridgeTtlSeconds, 3600));
    const expiresAt = Date.now() + ttl * 1000;
    return { token:signBridgeSession(config.cookieSecret, config.username, expiresAt), expiresAt, expiresInSeconds:ttl, scope:'operator' };
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
    if (!value) { const target=safeNext(req.originalUrl || req.url || '/'); return res.redirect(303, `/login?next=${encodeURIComponent(target)}`); }
    req.wallIdentity = value; return next();
  }
  function requireApi(req, res, next) {
    const value = identity(req);
    if (!value) return res.status(401).json({ ok:false, error:'wall_auth_required' });
    req.wallIdentity = value; return next();
  }
  function loginPage(req, res) {
    const next=safeNext(req.query?.next);
    if (identity(req)) return res.redirect(303, next);
    setLoginSecurity(res); return res.status(200).type('html').send(loginHtml('', next));
  }
  function login(req, res) {
    const key = attemptKey(req), now = Date.now(), history = recentFailures(key, now);
    if (history.length >= LOGIN_MAX_ATTEMPTS) {
      const retry = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - history[0])) / 1000));
      res.set('Retry-After', String(retry)); setLoginSecurity(res);
      return res.status(429).type('html').send(loginHtml('Too many failed attempts. Try again later.', safeNext(req.body?.next)));
    }
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    const ok = credentialsOk(username, password);
    if (!ok) {
      history.push(now); failures.set(key, history); setLoginSecurity(res);
      return res.status(401).type('html').send(loginHtml('Invalid username or password.', safeNext(req.body?.next)));
    }
    failures.delete(key);
    const expiresAt = Date.now() + config.sessionTtlSeconds * 1000;
    res.set('Set-Cookie', sessionCookie(cookieName, signSession(config.cookieSecret, config.username, expiresAt), config.sessionTtlSeconds, cookieSecure));
    return res.redirect(303, safeNext(req.body?.next));
  }
  function requireBridgeSession(req, res, next) {
    const value = bridgeIdentity(req);
    if (!value) return res.status(401).json({ ok:false, error:'bridge_session_required' });
    req.bridgeIdentity = value; return next();
  }
  function bridgeLogin(req, res) {
    const key = attemptKey(req), now = Date.now(), history = recentFailures(key, now);
    if (history.length >= LOGIN_MAX_ATTEMPTS) {
      const retry = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - history[0])) / 1000));
      res.set('Retry-After', String(retry));
      return res.status(429).json({ ok:false, error:'bridge_login_rate_limited', retryAfterSeconds:retry });
    }
    const username = String(req.body?.username || '');
    const password = String(req.body?.password || '');
    if (!credentialsOk(username, password)) {
      history.push(now); failures.set(key, history);
      return res.status(401).json({ ok:false, error:'invalid_bridge_credentials' });
    }
    failures.delete(key);
    return res.status(200).json({ ok:true, session:mintBridgeSession() });
  }
  function logout(_req, res) {
    res.set('Set-Cookie', clearCookie(cookieName, cookieSecure));
    return res.redirect(303, '/login');
  }
  return { loginPage, login, logout, requirePage, requireApi, identity, bridgeLogin, requireBridgeSession, bridgeIdentity,
    verifyCredentials:credentialsOk, verifyBridgeToken, mintBridgeSession, signOAuthToken, verifyOAuthToken,
    info: () => ({ mode:config.mode, username:config.username, sessionTtlSeconds:config.sessionTtlSeconds, bridgeSessionTtlSeconds:bridgeTtlSeconds, cookieSecure, cookieName }) };
}
