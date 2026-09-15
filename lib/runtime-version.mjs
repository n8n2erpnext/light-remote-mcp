import fs from 'node:fs';

function readCandidate(url){
  try{
    const file=new URL(url,import.meta.url),text=fs.readFileSync(file,'utf8').trim();
    if(!text)return null;
    if(String(file.pathname).endsWith('.json')){const parsed=JSON.parse(text);return parsed?.version?String(parsed.version).trim():null;}
    return text;
  }catch{return null;}
}

export function runtimeVersion({env=process.env,envNames=['LIGHT_REMOTE_VERSION','OPERATOR_VERSION','OPERATOR_AGENT_VERSION'],fallback='0.9.0-dev'}={}){
  for(const name of envNames){const value=String(env?.[name]||'').trim();if(value)return value;}
  for(const rel of ['../manifest.json','../VERSION','../../VERSION']){const value=readCandidate(rel);if(value)return value;}
  return fallback;
}
