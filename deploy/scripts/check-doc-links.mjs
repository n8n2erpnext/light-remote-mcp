import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Check only the canonical library entrypoints written under this governance
// edition. Older historical docs may contain known pre-existing link debt.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const book=path.join(root,'docs/project-book');
const names=['docs/README.md',...(await fs.readdir(book)).filter(x=>x.endsWith('.md')).map(x=>'docs/project-book/'+x)];
let checked=0;
const errors=[];
for(const name of names){
 const content=await fs.readFile(path.join(root,name),'utf8');
 for(const match of content.matchAll(/\]\(([^)]+)\)/g)){
  const destination=match[1].trim().split('#')[0].split('?')[0];
  if(!destination||/^(https?:|mailto:|data:|#)/i.test(destination))continue;
  const normalized=destination.replace(/^<|>$/g,'');
  const target=path.resolve(path.dirname(path.join(root,name)),normalized);
  if(!target.startsWith(root+path.sep)) {errors.push(name+': link_outside_repository '+destination);continue;}
  checked++;
  try{await fs.stat(target);}
  catch{errors.push(name+': missing '+destination);}
 }
}
if(errors.length){for(const line of errors.slice(0,30))console.error(line);process.exit(1);}
console.log(JSON.stringify({ok:true,canonicalDocuments:names.length,relativeLinksChecked:checked}));
