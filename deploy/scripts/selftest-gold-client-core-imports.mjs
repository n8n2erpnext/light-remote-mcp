import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const manifest=JSON.parse(fs.readFileSync(path.join(repo,'client/core-files.json'),'utf8'));
const listed=new Set(manifest.files.map(x=>x.source.replaceAll('\\','/')));
function visit(file,seen){
  if(seen.has(file))return;seen.add(file);
  const content=fs.readFileSync(path.join(repo,file),'utf8');
  for(const m of content.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+\.mjs)['"]/g)){
    const dep=path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1]));
    assert.ok(listed.has(dep),'Gold Client Core manifest missing statically imported '+dep+' (from '+file+')');
    visit(dep,seen);
  }
}
const reachable=new Set();
for(const entry of ['device-agent/operator-agent.mjs','device-agent/gold-wall-modules.mjs']){
  assert.ok(listed.has(entry),entry+' not in Gold Client Core manifest');
  visit(entry,reachable);
}
console.log('GOLD_WINDOWS_BUNDLED_AGENT_STATIC_IMPORT_CLOSURE_PASS files='+reachable.size);
