import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Stable, source-only library catalog. No network, no runtime/database access.
// Project Book governance is intentionally excluded to avoid self-referential churn.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const docs=path.join(root,'docs');
const outputDir=path.join(docs,'project-book');
const mode=process.argv[2];
if(!['--write','--check'].includes(mode)){
  console.error('Usage: node deploy/scripts/generate-doc-catalog.mjs --write|--check');
  process.exit(2);
}

const sources=[];
async function visit(dir){
  const entries=(await fs.readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
  for(const entry of entries){
    if(entry.isSymbolicLink())continue;
    const abs=path.join(dir,entry.name);
    const rel=path.relative(root,abs).split(path.sep).join('/');
    if(entry.isDirectory()){
      if(rel==='docs/project-book')continue;
      await visit(abs);
      continue;
    }
    if(!entry.isFile()||!(/\.(md|json)$/.test(entry.name)))continue;
    const blob=await fs.readFile(abs);
    const ext=path.extname(abs).slice(1);
    const item={
      path:rel,
      shelf:rel.split('/')[1]||'docs',
      extension:ext,
      bytes:blob.length,
      sha256:crypto.createHash('sha256').update(blob).digest('hex')
    };
    if(ext==='md'){
      const m=blob.toString('utf8').match(/^# +(.+)$/m);
      if(m)item.title=m[1].trim();
    }else{
      try{
        const json=JSON.parse(blob.toString('utf8'));
        if(json&&typeof json==='object'&&!Array.isArray(json))item.topLevelKeys=Object.keys(json).slice(0,12);
      }catch{item.parseStatus='invalid_json';}
    }
    sources.push(item);
  }
}
await visit(docs);
sources.sort((a,b)=>a.path.localeCompare(b.path,'en'));
const catalog={
  schemaVersion:'light-remote.project-book.source-catalog.v1',
  scope:'docs/**/*.md and docs/**/*.json, excluding docs/project-book to avoid self-reference',
  generatedBy:'deploy/scripts/generate-doc-catalog.mjs',
  counts:{total:sources.length,markdown:sources.filter(x=>x.extension==='md').length,json:sources.filter(x=>x.extension==='json').length},
  files:sources
};
const jsonText=JSON.stringify(catalog,null,2)+'\n';
const markdown=[
  '# Light Remote Source Catalog',
  '',
  'Status: generated-reference',
  'Source: deploy/scripts/generate-doc-catalog.mjs',
  '',
  'A bookmark and SHA-256 map for existing documentation outside project-book. A recorded hash proves file identity when generated, not deployment or current runtime truth. Source files retain original paths; historical records are not silently promoted to current authority.',
  '',
  'Regenerate: node deploy/scripts/generate-doc-catalog.mjs --write',
  'Validate: node deploy/scripts/generate-doc-catalog.mjs --check',
  '',
  'Documents: '+catalog.counts.total+' ('+catalog.counts.markdown+' Markdown, '+catalog.counts.json+' JSON).',
  '',
  '| Shelf | Source | Document | SHA-256 |',
  '| --- | --- | --- | --- |',
  ...sources.map(x=>'| '+x.shelf+' | ['+x.path+'](../'+x.path.slice(5)+') | '+String(x.title||x.topLevelKeys?.join(', ')||'').replace(/\|/g,'\\|').slice(0,96)+' | '+x.sha256+' |'),
  ''
].join('\n');
const targets=[
  [path.join(outputDir,'source_catalog.json'),jsonText],
  [path.join(outputDir,'SOURCE_CATALOG.md'),markdown]
];
if(mode==='--write'){
  await fs.mkdir(outputDir,{recursive:true});
  for(const [file,value] of targets)await fs.writeFile(file,value,{encoding:'utf8'});
  console.log(JSON.stringify({ok:true,mode,counts:catalog.counts,generated:targets.map(x=>path.relative(root,x[0]))}));
}else{
  let differences=0;
  for(const [file,expected] of targets){
    let found='';
    try{found=await fs.readFile(file,'utf8');}catch{}
    if(found!==expected){console.error('catalog_out_of_date: '+path.relative(root,file));differences++;}
  }
  if(differences)process.exit(1);
  console.log(JSON.stringify({ok:true,mode,counts:catalog.counts}));
}
