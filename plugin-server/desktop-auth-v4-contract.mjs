/**
 * Desktop V4 Owner Login: default-OFF pure security contract.
 *
 * NOT a mounted endpoint, credential, grant, session, token issuer or
 * authentication decision. The caller MUST verify the Account Portal Owner
 * session server-side before supplying authority. The eventual issuer MUST
 * atomically consume authorization codes and use a separate Desktop audience.
 *
 * Never reuse remote:* MCP OAuth bearer tokens for Desktop Owner authority.
 */
import crypto from 'node:crypto';

export const DESKTOP_OWNER_RESOURCE = 'urn:light-remote:desktop-owner:v4';
export const DESKTOP_OWNER_CLIENT_ID = 'light-remote-desktop-v4';
export const DESKTOP_OWNER_SCOPE = 'desktop:read';
export const DESKTOP_AUTH_CODE_TTL_MS = 90_000;

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL_STATE = /^[A-Za-z0-9_-]{43,128}$/;
const SAFE_OWNER_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function deny(code) {
  throw Object.assign(new Error(code), { code });
}

export function createDesktopPkceMaterial(randomBytes = crypto.randomBytes) {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url'),
    state: randomBytes(32).toString('base64url'),
    installNonce: randomBytes(32).toString('base64url')
  };
}

export function verifyDesktopPkceS256(challenge, verifier) {
  if (!BASE64URL_43.test(String(challenge || '')) ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(String(verifier || '')))
    return false;
  const derived = crypto.createHash('sha256').update(verifier, 'ascii').digest();
  const expected = Buffer.from(challenge, 'base64url');
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}

export function validateDesktopLoopbackCallback(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { deny('desktop_callback_invalid'); }
  const host = url.hostname;
  const port = Number(url.port);
  if (url.protocol !== 'http:' ||
      (host !== '127.0.0.1' && host !== '[::1]' && host !== '::1') ||
      !Number.isSafeInteger(port) || port < 1024 || port > 65535 ||
      url.pathname !== '/desktop/v4/callback' ||
      url.username || url.password || url.search || url.hash ||
      String(value).includes('\\'))
    deny('desktop_callback_not_loopback');
  return url.origin + url.pathname;
}

export function validateDesktopOwnerAuthorizationIntent(input, authority, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    deny('desktop_request_invalid');
  if (!authority || authority.verifiedBy !== 'account_portal_session' ||
      authority.isOwner !== true ||
      !SAFE_OWNER_ID.test(String(authority.accountId || '')))
    deny('verified_desktop_owner_required');
  if (Object.hasOwn(input, 'accountId') || Object.hasOwn(input, 'grantId') ||
      Object.hasOwn(input, 'agentId') || Object.hasOwn(input, 'bCode') ||
      Object.hasOwn(input, 'ownerConsentCode'))
    deny('desktop_request_forbidden_authority');
  if (input.clientId !== DESKTOP_OWNER_CLIENT_ID ||
      input.resource !== DESKTOP_OWNER_RESOURCE ||
      input.scope !== DESKTOP_OWNER_SCOPE ||
      input.responseType !== 'code' ||
      input.codeChallengeMethod !== 'S256' ||
      !BASE64URL_43.test(String(input.codeChallenge || '')) ||
      !BASE64URL_STATE.test(String(input.state || '')) ||
      !BASE64URL_43.test(String(input.installNonce || '')))
    deny('desktop_request_invalid');
  if (!Number.isSafeInteger(now) || now < 0)
    deny('desktop_clock_invalid');
  const redirectUri = validateDesktopLoopbackCallback(input.redirectUri);
  return Object.freeze({
    purpose: 'desktop_owner_login_v4',
    ownerAccountId: authority.accountId,
    clientId: DESKTOP_OWNER_CLIENT_ID,
    resource: DESKTOP_OWNER_RESOURCE,
    scope: DESKTOP_OWNER_SCOPE,
    responseType: 'code',
    codeChallengeMethod: 'S256',
    codeChallenge: input.codeChallenge,
    redirectUri,
    state: input.state,
    installNonce: input.installNonce,
    issuedAt: now,
    expiresAt: now + DESKTOP_AUTH_CODE_TTL_MS
  });
}
