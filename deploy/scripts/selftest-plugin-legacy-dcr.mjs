import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-legacy-dcr-'));
const origin='https://light-remote.thaiduy.digital';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const token=[
  b64({alg:'HS256',typ:'JWT'}),
  b64({redirect_uris:[redirect],client_name:'ChatGPT',token_use:'client',iss:origin,aud:`${origin}/oauth/register`,iat:1700000000,jti:'legacy-selftest'}),
  Buffer.from('not-signed-by-current-key').toString('base64url')
].join('.');
const hash=crypto.createHash('sha256').update(token).digest('hex');
const secretFile=path.join(tmp,'plugin-oauth-secret');
const legacyFile=path.join(tmp,'legacy-oauth-clients.json');
fs.writeFileSync(secretFile,crypto.randomBytes(48),{mode:0o600});
fs.writeFileSync(legacyFile,JSON.stringify({
  schemaVersion:1,
  clients:[{clientIdSha256:hash,client_name:'ChatGPT',redirect_uris:[redirect]}]
}),{mode:0o600});

process.env.LIGHT_REMOTE_PLUGIN_ORIGIN=origin;
process.env.LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE=secretFile;
process.env.LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE=legacyFile;
const {clientFromId}=await import('../../plugin-server/oauth.mjs');

const accepted=await clientFromId(token);
assert.equal(accepted?.legacyClient,true);
assert.deepEqual(accepted?.redirect_uris,[redirect]);
const changed=token.slice(0,-1)+(token.endsWith('A')?'B':'A');
assert.equal(await clientFromId(changed),null);
fs.rmSync(tmp,{recursive:true,force:true});
console.log('plugin_legacy_dcr_exact_match=PASS');
