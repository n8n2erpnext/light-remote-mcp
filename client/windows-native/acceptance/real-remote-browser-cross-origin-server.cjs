const http=require('http');
const fs=require('fs');

const portFile=process.argv[2];
if(!portFile) throw new Error('port file required');

let portA=0,portB=0;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

const pageA=()=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Light Remote Cross Origin A</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#121820;color:#f2f2f2;font:24px system-ui,sans-serif}main{text-align:center}a{display:inline-block;padding:24px 36px;border:2px solid #3a96dd;border-radius:14px;color:#fff;text-decoration:none;background:#18222d}</style></head>
<body><main><h1>Cross Origin A</h1><a href="http://127.0.0.1:${portB}/origin-b" aria-label="Light Remote Cross Origin Navigate">Navigate to Origin B</a></main></body></html>`;

const pageB=()=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Light Remote Cross Origin B</title>
<style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#101a16;color:#f2f2f2;font:24px system-ui,sans-serif}main{text-align:center}button{font:inherit;padding:28px 44px;min-width:420px;border-radius:16px;border:2px solid #3a96dd;background:#18222d;color:#fff}button[aria-pressed="true"]{border-color:#16c60c;background:#12331a}</style></head>
<body><main><h1>Cross Origin B</h1><button id="target" type="button" aria-label="Light Remote Cross Origin Target" aria-pressed="false">Cross Origin Action</button></main>
<script>const t=document.getElementById('target');t.addEventListener('click',()=>{t.setAttribute('aria-pressed','true');t.setAttribute('aria-label','Light Remote Cross Origin Accepted');t.textContent='Light Remote Cross Origin Accepted';document.title='Light Remote Cross Origin Accepted';});</script>
</body></html>`;

function respond(res,status,body){
  res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(body);
}
function handlerA(req,res){
  if(req.url==='/origin-a'||req.url==='/origin-a/') return respond(res,200,pageA());
  respond(res,404,'not found');
}
function handlerB(req,res){
  if(req.url==='/origin-b'||req.url==='/origin-b/') return respond(res,200,pageB());
  respond(res,404,'not found');
}
const serverA=http.createServer(handlerA);
const serverB=http.createServer(handlerB);
function ready(){
  if(!portA||!portB)return;
  fs.writeFileSync(portFile,JSON.stringify({a:portA,b:portB}));
}
serverA.listen(0,'127.0.0.1',()=>{portA=serverA.address().port;ready();});
serverB.listen(0,'127.0.0.1',()=>{portB=serverB.address().port;ready();});
const stop=()=>{serverA.close(()=>{});serverB.close(()=>{});setTimeout(()=>process.exit(0),50).unref();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
