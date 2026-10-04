import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICON_DIR=fileURLToPath(new URL('../assets/icons/material/',import.meta.url));
const ALIASES=Object.freeze({
  visibility:'visibility',
  visibilityOff:'visibility_off',
  copy:'content_copy',
  refresh:'refresh',
  link:'link',
  power:'power',
  security:'security',
  approve:'check_circle',
  device:'computer',
  pause:'pause',
  logout:'logout',
  settings:'settings',
  arrowBack:'arrow_back',
  add:'add',
  close:'close',
  star:'star',
  dashboard:'dashboard',
  group:'group',
  key:'key',
  devices:'devices',
  usage:'bar_chart',
  billing:'credit_card',
  download:'download',
  support:'support_agent',
  hub:'hub',
  terminal:'terminal',
  folder:'folder',
  search:'search',
  delete:'delete',
  edit:'edit'
});
const cache=new Map();
export function materialIconFile(name){
  const id=ALIASES[name]||String(name||'').trim();
  if(!/^[a-z0-9_]+$/.test(id))throw new Error('invalid_material_icon:'+name);
  const file=path.join(ICON_DIR,id+'.svg');
  if(!fs.existsSync(file))throw new Error('unknown_material_icon:'+name);
  return file;
}
export function materialIcon(name,{className='mi'}={}){
  const key=name+'|'+className;
  if(cache.has(key))return cache.get(key);
  let svg=fs.readFileSync(materialIconFile(name),'utf8').trim();
  svg=svg.replace(/fill="[^"]*"/,'fill="currentColor"');
  svg=svg.replace('<svg ','<svg class="'+className+'" aria-hidden="true" focusable="false" ');
  cache.set(key,svg);
  return svg;
}
