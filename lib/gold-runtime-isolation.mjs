import path from 'node:path';
import fs from 'node:fs';

// Activated only for new isolated Gold staging; never changes existing release defaults.
export function assertGoldRuntimeIsolation(env,role){
  if(env.LIGHT_REMOTE_GOLD_INDEPENDENT!=='1')return {isolated:false};
  if(!['operator','plugin'].includes(role))throw new Error('invalid_gold_role');
  const root=String(env.LIGHT_REMOTE_GOLD_ROOT||'');
  if(!path.isAbsolute(root)||root==='/'||root.length<8)throw new Error('gold_root_absolute_required');
  const normalized=path.resolve(root);
  const within=(key,{optional=false}={})=>{
    const value=String(env[key]||'').trim();
    if(!value&&optional)return;
    if(!path.isAbsolute(value))throw new Error('gold_isolation_missing_'+key);
    const absolute=path.resolve(value);
    if(absolute===normalized||!absolute.startsWith(normalized+path.sep))
      throw new Error('gold_isolation_outside_root_'+key);
    // Reject symlink escape when the path already exists.
    const candidate=fs.existsSync(absolute)?fs.realpathSync(absolute):path.dirname(absolute);
    if(fs.existsSync(candidate)){
      const resolved=fs.realpathSync(candidate);
      if(resolved!==normalized&&!resolved.startsWith(normalized+path.sep))
        throw new Error('gold_isolation_symlink_escape_'+key);
    }
  };
  const common=['OPERATOR_SOCKET'];
  const keys=role==='operator'
    ?[...common,'OPERATOR_STATE_DIR','OPERATOR_LOG_DIR','OPERATOR_KEY_FILE']
    :[...common,'LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE','LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE',
      'LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE','LIGHT_REMOTE_PADDLE_STATE_FILE',
      'LIGHT_REMOTE_SITE_ANALYTICS_PATH','LIGHT_REMOTE_SITE_CONTENT_PATH',
      'LIGHT_REMOTE_SUPPORT_OUTBOX_FILE','LIGHT_REMOTE_GOOGLE_OAUTH_FILE',
      'LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE','LIGHT_REMOTE_DISTRIBUTION_DIR'];
  for(const key of keys)within(key);
  if(role==='operator'){
    within('OPERATOR_TEAM_INVITE_SECRET_FILE',{optional:true});
    within('OPERATOR_TEAM_OAUTH_VERIFY_KEY_FILE',{optional:true});
  }
  if(role==='plugin'){
    within('LIGHT_REMOTE_MAIL_ENV_FILE');
    within('LIGHT_REMOTE_OPENAI_CHALLENGE_FILE');
    if(String(env.LIGHT_REMOTE_PADDLE_ENV||'sandbox').toLowerCase()==='live')
      throw new Error('gold_staging_live_paddle_forbidden');
  }
  if(role==='plugin'){
    const host=String(env.LIGHT_REMOTE_PLUGIN_HOST||'');
    const origin=String(env.LIGHT_REMOTE_PLUGIN_ORIGIN||'');
    if(host!=='127.0.0.1'||!/^http:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin)
      ||env.LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK!=='1')
      throw new Error('gold_staging_requires_loopback_origin');
  }
  // An isolated staging instance cannot silently bind to the production service socket.
  if(String(env.OPERATOR_SOCKET).includes('/run/gpt-vps-operator/operator.sock'))
    throw new Error('gold_production_socket_forbidden');
  return {isolated:true,role};
}
