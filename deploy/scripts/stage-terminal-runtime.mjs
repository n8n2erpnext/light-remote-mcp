import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const [targetArg,platformArg,archArg]=process.argv.slice(2);
const target=path.resolve(targetArg||'');
const platform=String(platformArg||'').toLowerCase();
const arch=String(archArg||'').toLowerCase();
if(!targetArg||!['linux','darwin','win32'].includes(platform)||!['x64','arm64'].includes(arch)){
  throw new Error('usage: stage-terminal-runtime.mjs <target-root> <linux|darwin|win32> <x64|arm64>');
}
const pkgName=platform==='linux'?'@homebridge/node-pty-prebuilt-multiarch':'node-pty';
const pkgParts=pkgName.split('/');
const source=path.join(repo,'node_modules',...pkgParts);
const destination=path.join(target,'node_modules',...pkgParts);
if(!fs.existsSync(source))throw new Error(`terminal_runtime_source_missing:${pkgName}`);
fs.mkdirSync(path.dirname(destination),{recursive:true});
fs.rmSync(destination,{recursive:true,force:true});
fs.cpSync(source,destination,{recursive:true});
const keepPrebuild=`${platform}-${arch}`;
const prebuildRoot=path.join(destination,'prebuilds');
if(fs.existsSync(prebuildRoot))for(const name of fs.readdirSync(prebuildRoot))if(name!==keepPrebuild)fs.rmSync(path.join(prebuildRoot,name),{recursive:true,force:true});
fs.rmSync(path.join(destination,'third_party'),{recursive:true,force:true});
fs.rmSync(path.join(destination,'build'),{recursive:true,force:true});
const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json'),'utf8'));
if(!pkg.version)throw new Error('terminal_runtime_package_invalid');
let nativePath='';
if(platform==='linux'){
  nativePath=path.join(destination,'prebuilds',`linux-${arch}`,'node.abi127.node');
}else if(platform==='darwin'){
  const helperPath=path.join(destination,'prebuilds',`darwin-${arch}`,'spawn-helper');
  nativePath=path.join(destination,'prebuilds',`darwin-${arch}`,'pty.node');
  if(!fs.existsSync(helperPath))throw new Error(`terminal_runtime_spawn_helper_missing:${platform}-${arch}`);
  fs.chmodSync(helperPath,0o755);
  const helperMode=fs.statSync(helperPath).mode&0o777;
  if((helperMode&0o111)===0)throw new Error(`terminal_runtime_spawn_helper_not_executable:${platform}-${arch}:${helperMode.toString(8)}`);
}else{
  nativePath=path.join(destination,'prebuilds',`win32-${arch}`,'pty.node');
}
if(!fs.existsSync(nativePath))throw new Error(`terminal_runtime_native_missing:${platform}-${arch}`);
const licenseCandidates=['LICENSE','LICENSE.md','LICENSE.txt'].map(name=>path.join(destination,name));
const license=licenseCandidates.find(file=>fs.existsSync(file));
if(!license)throw new Error('terminal_runtime_license_missing');
const licenseDir=path.join(target,'licenses','terminal-runtime');
fs.mkdirSync(licenseDir,{recursive:true});
fs.copyFileSync(license,path.join(licenseDir,platform==='linux'?'homebridge-node-pty-LICENSE':'node-pty-LICENSE'));
console.log(`terminal_runtime_package=${pkgName}@${pkg.version}`);
console.log(`terminal_runtime_native=${path.relative(target,nativePath).replaceAll('\\','/')}`);
console.log('terminal_runtime_stage=PASS');
