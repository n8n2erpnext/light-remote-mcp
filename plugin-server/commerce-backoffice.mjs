import fs from 'node:fs';

const DEFAULT_CONFIG_FILE=String(process.env.LIGHT_REMOTE_BACKOFFICE_CONFIG_FILE||'/etc/light-remote-direct/backoffice.json');

function loadConfig(file=DEFAULT_CONFIG_FILE){
  const row=JSON.parse(fs.readFileSync(file,'utf8'));
  if(row?.schemaVersion!==1)throw new Error('backoffice_config_schema_invalid');
  const endpoint=String(row.endpoint||'').trim();
  if(!/^https?:\/\//.test(endpoint))throw new Error('backoffice_endpoint_invalid');
  const authMode=String(row.authMode||'token').trim().toLowerCase();
  const apiKey=String(row.apiKey||'').trim(),apiSecret=String(row.apiSecret||'').trim();
  if(authMode==='token'&&(!apiKey||!apiSecret))throw new Error('backoffice_credentials_missing');
  if(!['token','internal-network'].includes(authMode))throw new Error('backoffice_auth_mode_invalid');
  return {endpoint,authMode,apiKey,apiSecret,siteHost:String(row.siteHost||'').trim()};
}

function methodEndpoint(config,method){
  const url=new URL(config.endpoint);
  const replaced=url.pathname.replace(/(light_backoffice\.api\.)[^/]+$/, '$1'+method);
  if(replaced===url.pathname)throw new Error('backoffice_commerce_endpoint_invalid');
  url.pathname=replaced;
  url.search='';
  return url.toString();
}

async function post(method,payload,{configFile=DEFAULT_CONFIG_FILE,fetchImpl=globalThis.fetch}={}){
  const config=loadConfig(configFile);
  const headers={'content-type':'application/json','accept':'application/json'};
  if(config.authMode==='token')headers.authorization='token '+config.apiKey+':'+config.apiSecret;
  if(config.siteHost)headers.host=config.siteHost;
  const response=await fetchImpl(methodEndpoint(config,method),{
    method:'POST',
    headers,
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(12_000),
  });
  const raw=await response.text();
  let body={};
  try{body=raw?JSON.parse(raw):{};}catch{}
  if(!response.ok)throw Object.assign(new Error('backoffice_commerce_http_'+response.status+':'+(body?.exception||body?.message||raw.slice(0,180))),{status:502});
  const message=body?.message||body||{};
  if(message?.accepted!==true)throw Object.assign(new Error('backoffice_commerce_not_accepted'),{status:502});
  return message;
}

export async function recordPaddlePurchase(payload,options){
  return post('record_purchase_internal',payload,options);
}

export async function recordPaddleRefund(payload,options){
  return post('record_refund_internal',payload,options);
}
