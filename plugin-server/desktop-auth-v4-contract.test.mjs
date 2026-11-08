import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_AUTH_CODE_TTL_MS, DESKTOP_OWNER_RESOURCE,
  createDesktopPkceMaterial, verifyDesktopPkceS256,
  validateDesktopLoopbackCallback, validateDesktopOwnerAuthorizationIntent
} from './desktop-auth-v4-contract.mjs';

const authority = { verifiedBy: 'account_portal_session', accountId: 'owner_valid_123', isOwner:true };
const make = () => {
  const p = createDesktopPkceMaterial();
  return {
    clientId: 'light-remote-desktop-v4', resource: DESKTOP_OWNER_RESOURCE,
    scope: 'desktop:read', responseType: 'code', codeChallengeMethod: 'S256',
    redirectUri: 'http://127.0.0.1:49152/desktop/v4/callback',
    codeChallenge: p.challenge, state: p.state, installNonce: p.installNonce,
    verifier: p.verifier
  };
};
test('PKCE S256 material is random, fixed strength and verifier-bound', () => {
  const a = make(), b = make();
  assert.notEqual(a.codeChallenge, b.codeChallenge);
  assert.equal(a.codeChallenge.length, 43);
  assert.equal(a.state.length, 43);
  assert.equal(a.installNonce.length, 43);
  assert.equal(verifyDesktopPkceS256(a.codeChallenge, a.verifier), true);
  assert.equal(verifyDesktopPkceS256(a.codeChallenge, b.verifier), false);
  assert.equal(verifyDesktopPkceS256('bad', a.verifier), false);
});
test('only literal IPv4/IPv6 loopback and exact callback path are allowed', () => {
  assert.equal(validateDesktopLoopbackCallback('http://[::1]:49152/desktop/v4/callback'),
    'http://[::1]:49152/desktop/v4/callback');
  for (const invalid of [
    'https://localhost:49152/desktop/v4/callback',
    'http://localhost.evil.example:49152/desktop/v4/callback',
    'http://0.0.0.0:49152/desktop/v4/callback',
    'http://127.0.0.2:49152/desktop/v4/callback',
    'http://127.0.0.1:80/desktop/v4/callback',
    'http://127.0.0.1:65536/desktop/v4/callback',
    'http://127.0.0.1:49152/admin',
    'http://127.0.0.1:49152/desktop/v4/callback?token=bad',
    'http://127.0.0.1:49152/desktop/v4/callback#secret',
    'http://owner@127.0.0.1:49152/desktop/v4/callback'
  ]) assert.throws(() => validateDesktopLoopbackCallback(invalid));
});
test('intent is scoped to real browser Owner account with no A/B grant', () => {
  const input = make();
  const receipt = validateDesktopOwnerAuthorizationIntent(input, authority, 1000);
  assert.equal(receipt.ownerAccountId, authority.accountId);
  assert.equal(receipt.expiresAt, 1000 + DESKTOP_AUTH_CODE_TTL_MS);
  assert.equal(receipt.scope, 'desktop:read');
  assert.equal(receipt.purpose, 'desktop_owner_login_v4');
  assert.equal('verifier' in receipt, false);
  assert.equal('bCode' in receipt, false);
  assert.equal(Object.isFrozen(receipt), true);
});
test('rejects unverified principals and client-supplied owner/Agent authority', () => {
  const input = make();
  for (const principal of [null, {}, { verifiedBy:'oauth_mcp', accountId:'owner_valid_123' },
    { verifiedBy:'account_portal_session', accountId:'owner space', isOwner:true },
    { verifiedBy:'account_portal_session', accountId:'valid_non_owner', isOwner:false }])
    assert.throws(() => validateDesktopOwnerAuthorizationIntent(input, principal));
  for (const dangerous of ['accountId', 'grantId', 'agentId', 'bCode', 'ownerConsentCode'])
    assert.throws(() => validateDesktopOwnerAuthorizationIntent({ ...input, [dangerous]: 'forged' }, authority));
});
test('refuses MCP audience, remote execute, wrong method/client and weak state', () => {
  const input = make();
  for (const delta of [
    { resource:'https://example.com/mcp' }, { scope:'remote:execute' },
    { scope:'desktop:write' }, { responseType:'token' },
    { codeChallengeMethod:'plain' }, { clientId:'chatgpt-mcp' },
    { state:'weak' }, { codeChallenge:'short' }, { installNonce:'weak' }
  ]) assert.throws(() => validateDesktopOwnerAuthorizationIntent({ ...input, ...delta }, authority));
});
