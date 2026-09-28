import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const roots=['device-agent','operator-host','gateway','client','api','lib','.github/workflows'];
const forbidden=[
  /Real Remote/i,/real-remote/i,/desktop-live/i,/desktop-observe/i,/desktop-input/i,/desktop-act/i,/RealRemote/,/UIAutomation/,/native-desktop/,
  /x-light-netlify-bridge/i,/nmcp\.dashboard\.thaiduy\.store/i
];
function walk(dir){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.name==='node_modules'||ent.name==='.git')continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())out.push(...walk(p));else out.push(p);
  }
  return out;
}
for(const rel of roots){
  const dir=path.join(root,rel);if(!fs.existsSync(dir))continue;
  for(const file of walk(dir)){
    let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}
    for(const re of forbidden)if(re.test(text))throw new Error(`stable_scope_forbidden_marker:${path.relative(root,file)}:${re}`);
  }
}
for(const forbiddenPath of ['netlify','netlify.toml'])if(fs.existsSync(path.join(root,forbiddenPath)))throw new Error(`stable_scope_forbidden_path:${forbiddenPath}`);
console.log('v091-stable-scope-no-realremote-no-netlify=PASS');
