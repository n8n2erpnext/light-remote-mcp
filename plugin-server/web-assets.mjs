import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSET_ROOT=fileURLToPath(new URL('../assets/',import.meta.url));
const FONT_ROOT=path.join(ASSET_ROOT,'fonts','web');
const ICON_ROOT=path.join(ASSET_ROOT,'icons','material');
const PLATFORM_ICON_ROOT=path.join(ASSET_ROOT,'icons','platform');

const fontMap=Object.freeze({
  'GoogleSans-Variable.ttf':'GoogleSans-Variable.ttf',
  'CascadiaCode.ttf':'CascadiaCode.ttf'
});
function safeAsset(root,name){
  const base=String(name||'').trim();
  if(!/^[a-z0-9_-]+\.svg$/.test(base))return null;
  const file=path.join(root,base);
  return file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile()?file:null;
}
function safeIcon(name){return safeAsset(ICON_ROOT,name);}
function safePlatformIcon(name){return safeAsset(PLATFORM_ICON_ROOT,name);}
export function registerWebAssets(app){
  app.get('/assets/fonts/:name',(req,res)=>{
    const fileName=fontMap[String(req.params.name||'')];
    if(!fileName)return res.status(404).end();
    const file=path.join(FONT_ROOT,fileName);
    if(!fs.existsSync(file))return res.status(404).end();
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options','nosniff');
    return res.type('font/ttf').sendFile(file);
  });
  app.get('/assets/icons/material/:name',(req,res)=>{
    const file=safeIcon(String(req.params.name||''));
    if(!file)return res.status(404).end();
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options','nosniff');
    return res.type('image/svg+xml').sendFile(file);
  });
  app.get('/assets/icons/platform/:name',(req,res)=>{
    const file=safePlatformIcon(String(req.params.name||''));
    if(!file)return res.status(404).end();
    res.set('Cache-Control','public, max-age=31536000, immutable');
    res.set('X-Content-Type-Options','nosniff');
    return res.type('image/svg+xml').sendFile(file);
  });
}
