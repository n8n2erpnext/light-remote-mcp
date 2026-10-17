import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const project=path.resolve(import.meta.dirname,'../..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-gold-http-'));
fs.chmodSync(dir,0o700);
const key=path.join(dir,'secrets','plugin-oauth-secret');
fs.mkdirSync(path.dirname(key),{recursive:true,mode:0o700});
fs.writeFileSync(key,crypto.randomBytes(48).toString('base64url'),{mode:0o600});
const listener=net.createServer();
await new Promise((resolve,reject)=>listener.listen(0,'127.0.0.1',resolve).once('error',reject));
const port=listener.address().port;
await new Promise(resolve=>listener.close(resolve));
const inside=p=>path.join(dir,p);
const env={
  PATH:process.env.PATH||'/usr/bin:/bin',HOME:dir,TMPDIR:dir,NODE_ENV:'test',
  LIGHT_REMOTE_GOLD_INDEPENDENT:'1',LIGHT_REMOTE_GOLD_ROOT:dir,
  LIGHT_REMOTE_PLUGIN_HOST:'127.0.0.1',LIGHT_REMOTE_PLUGIN_PORT:String(port),
  LIGHT_REMOTE_PLUGIN_ORIGIN:'http://127.0.0.1:'+port,
  LIGHT_REMOTE_PLUGIN_ALLOW_HTTP_LOOPBACK:'1',
  OPERATOR_SOCKET:inside('runtime/gold-operator.sock'),
  LIGHT_REMOTE_PLUGIN_OAUTH_SECRET_FILE:key,
  LIGHT_REMOTE_PLUGIN_OAUTH_LEGACY_CLIENTS_FILE:inside('state/oauth-clients.json'),
  LIGHT_REMOTE_ACCOUNT_RECOVERY_FILE:inside('state/recovery.json'),
  LIGHT_REMOTE_PADDLE_STATE_FILE:inside('state/paddle.json'),
  LIGHT_REMOTE_SITE_ANALYTICS_PATH:inside('state/analytics.json'),
  LIGHT_REMOTE_SITE_CONTENT_PATH:inside('state/announcements.json'),
  LIGHT_REMOTE_SUPPORT_OUTBOX_FILE:inside('state/support-outbox.json'),
  LIGHT_REMOTE_GOOGLE_OAUTH_FILE:inside('state/google.json'),
  LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE:inside('secrets/backoffice.json'),
  LIGHT_REMOTE_DISTRIBUTION_DIR:inside('distribution'),
  LIGHT_REMOTE_MAIL_ENV_FILE:inside('secrets/mail.env'),
  LIGHT_REMOTE_OPENAI_CHALLENGE_FILE:inside('secrets/openai-challenge'),
  LIGHT_REMOTE_PADDLE_ENV:'sandbox',
  LIGHT_REMOTE_PADDLE_CHECKOUT_ENABLED:'false'
};
const child=spawn(process.execPath,[path.join(project,'plugin-server','server.mjs')],{
 cwd:path.join(project,'plugin-server'),env,stdio:['ignore','pipe','pipe']
});
let output='';
child.stdout.on('data',b=>output+=(b.toString()).slice(0,1500));
child.stderr.on('data',b=>output+=(b.toString()).slice(0,1500));
const base='http://127.0.0.1:'+port;
try{
  let ready=false;
  for(let i=0;i<85;i++){
    if(child.exitCode!==null)break;
    try{const h=await fetch(base+'/healthz');if(h.ok){const j=await h.json();assert(j.ok);ready=true;break}}catch{}
    await new Promise(r=>setTimeout(r,90));
  }
  assert(ready,'gold_isolated_plugin_not_ready: '+output.slice(-1200));
  const home=await fetch(base+'/');assert.equal(home.status,200);
  const html=await home.text();
  assert(html.includes('lightRemoteAiGuideSource'));
  assert(html.includes('data-copy-ai="prompt"'));
  const guide=await fetch(base+'/ai-guide');
  assert.equal(guide.status,200);assert((await guide.text()).includes('Copy complete guide (offline)'));
  const md=await fetch(base+'/ai-guide.md');assert.equal(md.status,200);
  assert((await md.text()).startsWith('# Light Remote — Complete AI Guide'));
  const robots=await fetch(base+'/llms.txt');assert.equal(robots.status,200);
  assert((await robots.text()).includes('/ai-guide.md'));
  const mcp=await fetch(base+'/mcp',{method:'GET'});assert.equal(mcp.status,405);
  console.log('GOLD_ISOLATED_PLUGIN_HTTP_HEALTH_V4_GUIDE_MCP_METHOD_PASS');
  console.log('GOLD_PLUGIN_ENV_INDEPENDENT_NO_PRODUCTION_SOCKET_KEYS_OR_DATA_PASS');
}finally{
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,1100))]);
  if(child.exitCode===null)child.kill('SIGKILL');
  fs.rmSync(dir,{recursive:true,force:true});
}
