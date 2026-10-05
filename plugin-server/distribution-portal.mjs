import fs from 'node:fs';
import path from 'node:path';

const DIST_DIR=String(process.env.LIGHT_REMOTE_DISTRIBUTION_DIR||'/var/lib/light-remote-direct/distribution');
const MANIFEST_FILE=String(process.env.LIGHT_REMOTE_DISTRIBUTION_MANIFEST||path.join(DIST_DIR,'manifest.json'));
const FALLBACK={
  schemaVersion:1,
  channel:'rc.31',
  generatedAt:null,
  endpoint:'https://light-remote.thaiduy.digital',
  releases:[
    {id:'windows',label:'Windows x64',kind:'desktop',description:'Tray client + Local Wall + Real Remote V2.',available:false,file:null,installHint:'Windows RC.31 is built and validated; permanent public asset publishing is being wired next.'},
    {id:'macos',label:'macOS',kind:'desktop',description:'Native desktop launcher + Light Remote agent.',available:false,file:null,installHint:'Signed/notarized package will appear here when published.'},
    {id:'linux-desktop',label:'Linux Desktop ARM64',kind:'desktop',description:'Debian package with Local Wall and terminal runtime.',available:false,file:null,installHint:'Install the .deb package, then open Local Wall to link the device.'},
    {id:'linux-server',label:'Linux Server / Terminal',kind:'server',description:'Headless Light Remote device agent for Linux servers and VPS terminals.',available:false,file:null,installCommand:'curl -fsSL https://light-remote.thaiduy.digital/downloads/install.sh | bash',installHint:'The install script auto-detects x64/ARM64, verifies SHA256, installs the systemd service, then starts Local Wall.'}
  ]
};

function esc(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function manifest(){
  try{
    if(!fs.existsSync(MANIFEST_FILE))return structuredClone(FALLBACK);
    const row=JSON.parse(fs.readFileSync(MANIFEST_FILE,'utf8'));
    if(row?.schemaVersion!==1||!Array.isArray(row.releases))throw new Error('invalid_distribution_manifest');
    return row;
  }catch{return structuredClone(FALLBACK);}
}
function safeFile(name){
  const base=path.basename(String(name||''));if(!base||base!==name||base.includes('..'))return null;
  const m=manifest(),release=m.releases.find(r=>r?.available===true&&r?.file===base);
  if(!release)return null;
  const remote=String(release.url||'');
  if(remote){
    if(!/^https:\/\//i.test(remote))return null;
    return {url:remote,release};
  }
  const file=path.join(DIST_DIR,base);
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return null;
  return {file,release};
}
function page(){
  return `<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Light Remote — Downloads</title><script src="/account/assets/theme.js"></script><link rel="stylesheet" href="/account/assets/portal.css"></head><body><div class="download-shell"><header class="download-head"><a class="brand download-brand" href="/"><img src="/account/assets/light-remote-mark.svg" alt=""><span><strong>Light Remote</strong><small>Distribution</small></span></a><div class="download-actions"><a class="btn" href="/account">Account</a><a class="btn" href="/support">Support</a></div></header><main class="download-main"><section class="download-hero"><span class="eyebrow">RC.31 · Official Direct endpoint</span><h1>Install Light Remote</h1><p>Every client connects directly to <code>https://light-remote.thaiduy.digital</code>. After install, open the local Device Wall, choose Link device, and use the one-time code in your account portal.</p></section><div id="releaseGrid" class="download-grid"><div class="empty">Loading releases…</div></div><section class="panel install-flow"><div class="panel-head"><h2>Connect a new device</h2></div><div class="install-steps"><div><b>1</b><strong>Install</strong><span>Choose the package for the target machine.</span></div><div><b>2</b><strong>Link locally</strong><span>Open Device Wall and generate a one-time device code.</span></div><div><b>3</b><strong>Verify</strong><span>Enter that code under Account → Add a device.</span></div></div></section></main></div><script>
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){const r=await fetch('/downloads/manifest.json',{cache:'no-store'}),m=await r.json();releaseGrid.innerHTML=(m.releases||[]).map(x=>'<article id="'+esc(x.id)+'" class="download-card"><div class="download-card-top"><div><span class="download-kind">'+esc(x.kind||'client')+'</span><h2>'+esc(x.label)+'</h2></div><span class="badge '+(x.available?'online':'')+'">'+(x.available?'Available':'Coming soon')+'</span></div><p>'+esc(x.description||'')+'</p><div class="download-version">'+esc(x.version||m.channel||'RC.31')+'</div>'+(x.available&&x.file?'<a class="btn primary wide" href="/downloads/files/'+encodeURIComponent(x.file)+'">Download</a>':'<button class="btn wide" disabled>Not published yet</button>')+(x.installCommand?'<div class="muted download-hint"><code>'+esc(x.installCommand)+'</code></div>':'')+'<div class="muted download-hint">'+esc(x.installHint||'')+'</div></article>').join('')||'<div class="empty">No releases published yet.</div>'}load().catch(e=>releaseGrid.innerHTML='<div class="empty error">'+esc(e.message)+'</div>');
</script></body></html>`;
}

export function registerDistributionPortal(app){
  app.get(['/downloads','/downloads/'],(_q,res)=>res.type('html').send(page()));
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
