import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),verify=args[0]==='--verify',target=path.resolve(verify?args[1]||'':args[0]||'');
if(!target||target===path.resolve('.'))throw new Error('usage: node deploy/scripts/stage-client-core.mjs [--verify] <target-root>');
const spec=JSON.parse(fs.readFileSync(path.join(repo,'client/core-files.json'),'utf8'));
if(spec.schemaVersion!==1||!Array.isArray(spec.files)||!spec.files.length)throw new Error('invalid_client_core_manifest');
const version=fs.readFileSync(path.join(repo,'VERSION'),'utf8').trim();
const rows=[];
for(const item of spec.files){
  const src=path.join(repo,String(item.source)),dst=path.join(target,String(item.destination));
  if(!fs.existsSync(src))throw new Error(`client_core_source_missing:${item.source}`);
  if(!verify){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
  if(!fs.existsSync(dst))throw new Error(`client_core_target_missing:${item.destination}`);
  const sourceBytes=fs.readFileSync(src),targetBytes=fs.readFileSync(dst),sourceSha=crypto.createHash('sha256').update(sourceBytes).digest('hex'),targetSha=crypto.createHash('sha256').update(targetBytes).digest('hex');
  if(sourceSha!==targetSha)throw new Error(`client_core_hash_mismatch:${item.destination}`);
  rows.push({path:String(item.destination).replaceAll('\\','/'),sha256:sourceSha,size:sourceBytes.length});
}
rows.sort((a,b)=>a.path.localeCompare(b.path));
const digest=crypto.createHash('sha256').update(rows.map(r=>`${r.path}\0${r.sha256}\0${r.size}\n`).join('')).digest('hex');
const metaFile=path.join(target,'client-core.json');
if(verify){
  const meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));if(meta.schemaVersion!==1||meta.version!==version||meta.digest!==digest)throw new Error('client_core_metadata_mismatch');
}else{
  fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'VERSION'),`${version}\n`);fs.writeFileSync(metaFile,`${JSON.stringify({schemaVersion:1,version,digest,files:rows},null,2)}\n`);
}
console.log(`client_core_version=${version}`);console.log(`client_core_digest=${digest}`);console.log(`client_core_files=${rows.length}`);console.log(`client_core_mode=${verify?'verify':'stage'}`);
