import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from './config.mjs';

const DIST_DIR=String(process.env.LIGHT_REMOTE_DISTRIBUTION_DIR||'/var/lib/light-remote-direct/distribution');
const MANIFEST_FILE=String(process.env.LIGHT_REMOTE_DISTRIBUTION_MANIFEST||path.join(DIST_DIR,'manifest.json'));
const PORTAL_FILE=fileURLToPath(new URL('./downloads-portal.html',import.meta.url));
const FALLBACK={
  schemaVersion:1,
  channel:VERSION,
  generatedAt:null,
  endpoint:'https://light-remote.thaiduy.digital',
  releases:[
    {id:'windows',label:'Windows x64',kind:'desktop',description:'Tray client + Local Wall + Real Remote V2.',available:false,file:null,installHint:'Windows installer is temporarily unavailable.'},
    {id:'macos',label:'macOS',kind:'desktop',description:'Native desktop launcher + Light Remote agent.',available:false,file:null,warning:'Unsigned / Not notarized',installHint:'macOS prerelease packages are temporarily unavailable.'},
    {id:'linux-desktop',label:'Linux Desktop',kind:'desktop',description:'Debian package with Local Wall and terminal runtime.',available:false,file:null,installHint:'Linux desktop packages are temporarily unavailable.'},
    {id:'linux-server',label:'Linux Server / Terminal',kind:'server',description:'Headless Light Remote device agent for Linux servers and VPS terminals.',available:false,file:null,installCommand:'curl -fsSL https://light-remote.thaiduy.digital/downloads/install.sh | bash',installHint:'After a fresh install, run light-remote up to enroll.'}
  ]
};

function manifest(){
  try{
    if(!fs.existsSync(MANIFEST_FILE))return structuredClone(FALLBACK);
    const row=JSON.parse(fs.readFileSync(MANIFEST_FILE,'utf8'));
    if(row?.schemaVersion!==1||!Array.isArray(row.releases))throw new Error('invalid_distribution_manifest');
    return row;
  }catch{return structuredClone(FALLBACK);}
}
function releaseAssets(release){
  const rows=[];
  const add=asset=>{if(asset&&typeof asset==='object'&&asset.file)rows.push(asset);};
  add(release);
  add(release?.compact);
  add(release?.installer);
  for(const asset of Object.values(release?.assets||{}))add(asset);
  for(const asset of Object.values(release?.archives||{}))add(asset);
  return rows;
}
function safeFile(name){
  const base=path.basename(String(name||''));if(!base||base!==name||base.includes('..'))return null;
  const m=manifest();
  for(const release of m.releases||[]){
    if(release?.available!==true)continue;
    const asset=releaseAssets(release).find(row=>row.file===base);
    if(!asset)continue;
    const remote=String(asset.url||'');
    if(remote){
      if(!/^https:\/\//i.test(remote))return null;
      return {url:remote,release,asset};
    }
    const file=path.join(DIST_DIR,base);
    if(!fs.existsSync(file)||!fs.statSync(file).isFile())return null;
    return {file,release,asset};
  }
  return null;
}

export function registerDistributionPortal(app){
  app.get(['/downloads','/downloads/'],(_q,res)=>res.type('html').sendFile(PORTAL_FILE));
  app.get('/downloads/manifest.json',(_q,res)=>res.json(manifest()));
  app.get('/downloads/install.sh',(_q,res)=>{
    const remote=String(manifest().installScriptUrl||'');
    res.set('Cache-Control','public, max-age=300');res.set('X-Content-Type-Options','nosniff');
    if(/^https:\/\//i.test(remote))return res.redirect(302,remote);
    const file=new URL('./downloads-install-linux.sh',import.meta.url);
    res.type('text/x-shellscript');return res.send(fs.readFileSync(file,'utf8'));
  });
  app.get('/downloads/files/:name',(req,res)=>{
    const row=safeFile(String(req.params.name||''));if(!row)return res.status(404).json({ok:false,error:'distribution_file_not_found'});
    res.set('Cache-Control','public, max-age=3600');res.set('X-Content-Type-Options','nosniff');
    if(row.url)return res.redirect(302,row.url);
    return res.download(row.file,path.basename(row.file));
  });
}
