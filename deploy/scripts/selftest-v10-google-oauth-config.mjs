import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const googleSource=fs.readFileSync(path.join(root,'plugin-server/google-auth.mjs'),'utf8');
const pluginUnit=fs.readFileSync(path.join(root,'deploy/direct-linux/light-remote-direct-plugin.service'),'utf8');
if(!googleSource.includes("/var/lib/light-remote-direct/plugin-state/google-oauth.json"))throw new Error('google_default_state_path_not_isolated');
if(!pluginUnit.includes('ProtectSystem=strict')||!pluginUnit.includes('ReadWritePaths=/var/lib/light-remote-direct/plugin-state'))throw new Error('google_state_systemd_write_path_missing');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lr-google-auth-'));
const file=path.join(dir,'google-oauth.json');
process.env.LIGHT_REMOTE_GOOGLE_OAUTH_FILE=file;
try{
  const mod=await import('../../plugin-server/google-auth.mjs?selftest='+Date.now());
  const before=mod.googleAuthStatus();
  if(before.configured!==false)throw new Error('google_auth_should_start_unconfigured');
  const clientId='123456789012-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com';
  const clientSecret='GOCSPX-selftest-secret-1234567890';
  const after=mod.saveGoogleAuthConfig({clientId,clientSecret});
  if(!after.configured)throw new Error('google_auth_not_configured_after_save');
  if(after.origin!=='https://light-remote.thaiduy.digital')throw new Error('google_origin_mismatch');
  if(after.redirectUri!=='https://light-remote.thaiduy.digital/account/google/callback')throw new Error('google_redirect_mismatch');
  if('clientId' in after||'clientSecret' in after)throw new Error('google_status_leaks_credentials');
  const stat=fs.statSync(file);if((stat.mode&0o777)!==0o600)throw new Error('google_config_mode_not_0600');
  const disk=JSON.parse(fs.readFileSync(file,'utf8'));
  if(disk.clientId!==clientId||disk.clientSecret!==clientSecret)throw new Error('google_config_persist_mismatch');
  const auth=mod.beginGoogleAuth(),url=new URL(auth.url);
  if(url.origin!=='https://accounts.google.com'||url.searchParams.get('client_id')!==clientId)throw new Error('google_authorize_client_mismatch');
  if(url.searchParams.get('redirect_uri')!==after.redirectUri||url.searchParams.get('code_challenge_method')!=='S256')throw new Error('google_authorize_pkce_mismatch');
  let invalid=false;try{mod.saveGoogleAuthConfig({clientId:'bad',clientSecret:'bad'})}catch(e){invalid=e.message==='invalid_google_client_id'}
  if(!invalid)throw new Error('google_invalid_client_not_rejected');
  console.log('google-oauth-config-0600=PASS');
  console.log('google-oauth-status-no-secret=PASS');
  console.log('google-oauth-pkce-authorize=PASS');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
