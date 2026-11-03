/**
 * Desktop Owner V4 authorization code consent ? source-only, feature flagged.
 * No access/refresh tokens are created here. This does NOT authorize an
 * Agent or log an app in; the native secure vault/session bridge is separate.
 */
import crypto from 'node:crypto';
import { callOperatorJson } from './operator-client.mjs';
import {
  DESKTOP_OWNER_CLIENT_ID, DESKTOP_OWNER_RESOURCE, DESKTOP_OWNER_SCOPE,
  DESKTOP_AUTH_CODE_TTL_MS, validateDesktopOwnerAuthorizationIntent,
  validateDesktopLoopbackCallback, verifyDesktopPkceS256
} from './desktop-auth-v4-contract.mjs';

const ACCOUNT_COOKIE = '__Host-light_remote_account';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const CONSENT_TTL_SEC = 300;
const CODE_TTL_SEC = DESKTOP_AUTH_CODE_TTL_MS / 1000;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function sha(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function text(value) {
  return String(value ?? '').replace(/[&<>"']/g, function (c) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
  });
}
function cookieSession(req) {
  const parts = String(req.headers?.cookie || '').split(';');
  const pair = parts.find(p => p.trim().startsWith(ACCOUNT_COOKIE + '='));
  if (!pair) return '';
  try { return decodeURIComponent(pair.trim().slice(ACCOUNT_COOKIE.length+1)); }
  catch { return ''; }
}
export async function browserOwnerFromOperator(req) {
  const token = cookieSession(req);
  if (!token) return null;
  try {
    const out = await callOperatorJson('GET', '/v1/accounts/me', null,
      {'x-light-account-session': token});
    const id = String(out?.account?.accountId || '');
    // A signed-in account is not necessarily the one current Gold Owner.
    // Never issue Desktop Owner consent for a Free/Guest or former Owner.
    if (!id || out?.account?.isOwner !== true) return null;
    return {verifiedBy:'account_portal_session', accountId:id,isOwner:true,
      sessionFingerprint:sha(token),
      accountSessionId:String(out?.session?.sessionId||''),
      accountSessionExpiresAt:Number(out?.session?.expiresAt)||0};
  } catch { return null; }
}
function intentFromQuery(q) {
  for (const field of ['accountId','grantId','agentId','bCode','ownerConsentCode']) {
    if (Object.prototype.hasOwnProperty.call(q || {},field))
      fail('desktop_request_forbidden_authority');
  }
  return {
    clientId:q?.client_id, resource:q?.resource, scope:q?.scope,
    responseType:q?.response_type, codeChallenge:q?.code_challenge,
    codeChallengeMethod:q?.code_challenge_method, redirectUri:q?.redirect_uri,
    state:q?.state, installNonce:q?.install_nonce
  };
}
function strictBrowserPost(req, origin) {
  const site = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
  const requestOrigin = String(req.headers?.origin || '').trim();
  const type = String(req.headers?.['content-type'] || '').split(';')[0].trim();
  if (type !== 'application/x-www-form-urlencoded' ||
      site === 'cross-site' || site === 'same-site') return false;
  // A provided Origin must match exactly, regardless of Sec-Fetch-Site.
  if (requestOrigin) return requestOrigin === origin;
  if (site === 'same-origin') return true;
  // Chrome/browser proxy may omit BOTH provenance headers for a form POST.
  // Fail closed unless the form carries an unguessable one-use CSRF; the
  // subsequent verifyOwner() checks the Secure SameSite=Strict Portal cookie
  // against the CURRENT single Gold Owner before atomic CSRF consumption.
  return site === '' && TOKEN_PATTERN.test(String(req.body?.csrf || ''));
}
function setPrivate(res) {
  res.set('Cache-Control','no-store');
  res.set('Referrer-Policy','no-referrer');
  res.set('X-Content-Type-Options','nosniff');
  res.set('X-Robots-Tag','noindex, nofollow, noarchive');
}
function responseError(res, error) {
  const known = new Set([
    'desktop_consent_missing','desktop_consent_invalid','desktop_owner_mismatch',
    'desktop_rate_limited','desktop_storage_unavailable','desktop_request_invalid',
    'desktop_request_forbidden_authority','verified_desktop_owner_required',
    'desktop_clock_invalid','desktop_callback_invalid',
    'desktop_callback_not_loopback','desktop_public_origin_invalid'
  ]);
  const candidate = String(error?.code || error?.message || '');
  const code = known.has(candidate) ? candidate : 'desktop_unavailable';
  const status = code === 'desktop_consent_missing' ? 410
    : code === 'verified_desktop_owner_required' ? 401
    : code === 'desktop_rate_limited' ? 429
    : code === 'desktop_storage_unavailable' || code === 'desktop_unavailable' ? 503 : 400;
  return res.status(status).json({ok:false,error:code});
}
export function createDesktopOwnerAuthorization({
  redis, prefix, publicOrigin, verifyOwner = browserOwnerFromOperator,
  clock = Date.now, random = crypto.randomBytes
} = {}) {
  if (!redis || typeof redis.set !== 'function' ||
      typeof redis.getDel !== 'function' ||
      typeof redis.incr !== 'function' ||
      typeof redis.expire !== 'function' ||
      !/^lr:gold:[a-z0-9_-]+:$/.test(prefix || ''))
    fail('desktop_storage_unavailable');
  let origin;
  try { origin = new URL(publicOrigin); } catch { fail('desktop_public_origin_invalid'); }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' ||
      origin.search || origin.hash || origin.username || origin.password)
    fail('desktop_public_origin_invalid');
  const publicBase = origin.origin;
  const key = (kind, code) => prefix + 'desktop-v4:' + kind + ':' + sha(code);
  const random43 = () => random(32).toString('base64url');
  async function store(kind, code, row, ttl) {
    const ok = await redis.set(key(kind,code), JSON.stringify(row), {EX:ttl,NX:true});
    if (ok !== 'OK') fail('desktop_storage_unavailable');
  }
  async function consume(kind, code) {
    if (!TOKEN_PATTERN.test(String(code || ''))) fail('desktop_consent_missing');
    const raw = await redis.getDel(key(kind,code));
    if (!raw) fail('desktop_consent_missing');
    try { return JSON.parse(raw); } catch { fail('desktop_consent_invalid'); }
  }
  async function begin(q, owner) {
    const intent = validateDesktopOwnerAuthorizationIntent(intentFromQuery(q), owner, clock());
    if(!/^acctsess_[a-f0-9-]{36}$/.test(String(owner.accountSessionId||''))||
       !Number.isFinite(Number(owner.accountSessionExpiresAt))||
       Number(owner.accountSessionExpiresAt)<=clock())
      fail('verified_desktop_owner_required');
    // Bounded authenticated Owner intents: 12 per ten-minute bucket, with
    // the counter residing in Redis (not unbounded per-process RAM).
    const bucket = Math.floor(clock() / 600_000);
    const rateKey = prefix + 'desktop-v4:rate:' + sha(owner.accountId + ':' + bucket);
    const count = Number(await redis.incr(rateKey));
    if (count === 1) await redis.expire(rateKey, 620);
    if (!Number.isSafeInteger(count) || count < 1 || count > 12)
      fail('desktop_rate_limited');
    const csrf = random43();
    const record = {...intent, sessionFingerprint:owner.sessionFingerprint || '',
      accountSessionId:owner.accountSessionId, accountSessionExpiresAt:owner.accountSessionExpiresAt};
    await store('consent',csrf,record,CONSENT_TTL_SEC);
    return {csrf, intent};
  }
  async function approve({csrf, decision, owner}) {
    const record = await consume('consent',csrf);
    if (record.expiresAt <= clock() ||
        record.ownerAccountId !== owner?.accountId ||
        record.accountSessionId !== owner?.accountSessionId ||
        Number(record.accountSessionExpiresAt)<=clock() ||
        record.sessionFingerprint !== (owner?.sessionFingerprint || '') ||
        owner?.verifiedBy !== 'account_portal_session' ||
        owner?.isOwner !== true)
      fail('desktop_owner_mismatch');
    const callback = new URL(validateDesktopLoopbackCallback(record.redirectUri));
    callback.searchParams.set('state',record.state);
    callback.searchParams.set('iss',publicBase);
    if (decision === 'deny') {
      callback.searchParams.set('error','access_denied');
      return {redirect:callback.toString(), approved:false};
    }
    if (decision !== 'approve') fail('desktop_consent_invalid');
    const code = random43();
    await store('code',code,{
      purpose:'desktop_owner_login_v4', ownerAccountId:record.ownerAccountId,
      accountSessionId:record.accountSessionId,
      accountSessionExpiresAt:record.accountSessionExpiresAt,
      clientId:record.clientId, resource:record.resource, scope:record.scope,
      redirectUri:record.redirectUri, codeChallenge:record.codeChallenge,
      state:record.state, installNonce:record.installNonce,
      expiresAt:clock()+DESKTOP_AUTH_CODE_TTL_MS
    },CODE_TTL_SEC);
    callback.searchParams.set('code',code);
    return {redirect:callback.toString(), approved:true};
  }
  // Future T03c native token endpoint will call this server-side after
  // binding an OS vault and revocable Desktop session. Never send this
  // principal to a webview without issuing/scoping a real native session.
  async function consumeCode({code, verifier, redirectUri, installNonce, state}) {
    const record = await consume('code',code);
    if (record.purpose !== 'desktop_owner_login_v4' ||
        record.clientId !== DESKTOP_OWNER_CLIENT_ID ||
        record.resource !== DESKTOP_OWNER_RESOURCE ||
        record.scope !== DESKTOP_OWNER_SCOPE ||
        record.expiresAt <= clock() ||
        Number(record.accountSessionExpiresAt)<=clock() ||
        record.redirectUri !== validateDesktopLoopbackCallback(redirectUri) ||
        record.installNonce !== installNonce ||
        record.state !== state ||
        !verifyDesktopPkceS256(record.codeChallenge,verifier))
      fail('desktop_code_invalid');
    return Object.freeze({
      purpose:'desktop_owner_verified_once', accountId:record.ownerAccountId,
      accountSessionId:record.accountSessionId,
      accountSessionExpiresAt:record.accountSessionExpiresAt,
      resource:DESKTOP_OWNER_RESOURCE, scope:DESKTOP_OWNER_SCOPE,
      verifiedAt:clock()
    });
  }
  function consentHtml({csrf,intent}) {
    const callbackOrigin = new URL(intent.redirectUri).origin;
    // Only the exact vetted loopback origin is included in form-action CSP,
    // following Chrome behavior for 303 after POST, not a wildcard localhost.
    const csp = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' " +
      callbackOrigin + "; frame-ancestors 'none'; base-uri 'none'";
    const html = [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<title>Authorize Light Remote Desktop</title></head>',
      '<body style="font:16px sans-serif;max-width:540px;margin:10vh auto;padding:2em">',
      '<h1>Allow Light Remote Desktop V4?</h1>',
      '<p>Sign in to this device app with your verified Light Remote Owner account.</p>',
      '<p>Read-only account access. Agent A/B approval requires separate Owner consent.</p>',
      '<form method="POST" action="/account/desktop/v4/authorize">',
      '<input type="hidden" name="csrf" value="',text(csrf),'">',
      '<button type="submit" name="decision" value="approve">Continue to Desktop</button> ',
      '<button type="submit" name="decision" value="deny">Cancel</button>',
      '</form></body></html>'
    ].join('');
    return {html,csp};
  }
  async function getConsent(req,res) {
    setPrivate(res);
    try {
      const owner = await verifyOwner(req);
      if (!owner) {
        const path = '/account/desktop/v4/authorize?' + new URLSearchParams(req.query || {});
        if (path.length > 1800) fail('desktop_request_invalid');
        return res.redirect(303,'/account/login?next='+encodeURIComponent(path));
      }
      const ready = await begin(req.query, owner);
      const page = consentHtml(ready);
      res.set('Referrer-Policy','origin');
      res.set('Content-Security-Policy',page.csp);
      return res.status(200).type('html').send(page.html);
    } catch (error) { return responseError(res,error); }
  }
  async function postConsent(req,res) {
    setPrivate(res);
    if (!strictBrowserPost(req,publicBase))
      return res.status(403).json({ok:false,error:'desktop_origin_required'});
    try {
      const owner = await verifyOwner(req);
      if (!owner) fail('verified_desktop_owner_required');
      const issued = await approve({
        csrf:req.body?.csrf, decision:req.body?.decision, owner
      });
      return res.redirect(303,issued.redirect);
    } catch (error) { return responseError(res,error); }
  }
  return Object.freeze({begin,approve,consumeCode,getConsent,postConsent});
}

export function registerDesktopOwnerV4Authorization(app,{
  enabled = false, redis, prefix, publicOrigin,
  verifyOwner = browserOwnerFromOperator
} = {}) {
  if (!enabled) return {enabled:false, routes:0};
  const handler = createDesktopOwnerAuthorization({
    redis,prefix,publicOrigin,verifyOwner
  });
  app.get('/account/desktop/v4/authorize',handler.getConsent);
  app.post('/account/desktop/v4/authorize',handler.postConsent);
  // No token endpoint and no App-Wall SSO until T03c/T04 are fully verified.
  return {enabled:true,routes:2,consumeCode:handler.consumeCode};
}
