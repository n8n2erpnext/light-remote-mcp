import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const roots=['device-agent','operator-host','gateway','client','api','lib','.github/workflows'];
const forbidden=[/RealRemoteDesktopSession/,/RealRemoteHelper/,/HaloForm/,/x-light-netlify-bridge/i,/nmcp\.dashboard\.thaiduy\.store/i];

function walk(dir){
  const out=[];
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(['node_modules','.git','bin','obj','dist'].includes(ent.name))continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())out.push(...walk(p));else out.push(p);
  }
  return out;
}
for(const rel of roots){
  const dir=path.join(root,rel);if(!fs.existsSync(dir))continue;
  for(const file of walk(dir)){
    let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}
    for(const re of forbidden)if(re.test(text))throw new Error('stable_scope_forbidden_marker:'+path.relative(root,file)+':'+re);
  }
}
for(const forbiddenPath of ['netlify','netlify.toml'])if(fs.existsSync(path.join(root,forbiddenPath)))throw new Error('stable_scope_forbidden_path:'+forbiddenPath);
if(!fs.existsSync(path.join(root,'client/windows-native/GptOperator.RealRemoteV2/GptOperator.RealRemoteV2.csproj')))throw new Error('stable_scope_rmv2_missing');
console.log('v091-stable-scope-rmv2-no-rmv1-no-netlify=PASS');
