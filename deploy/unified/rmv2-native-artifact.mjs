import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function files(root,dir=root){
 const out=[];
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,item.name);if(fs.lstatSync(full).isSymbolicLink())throw Error('native_artifact_symlink');
  if(item.isDirectory())out.push(...files(root,full));else if(item.isFile()&&full!==path.join(root,'manifest.json'))out.push(path.relative(root,full).replaceAll('\\','/'));else if(!item.isFile())throw Error('native_artifact_file_type');
 }
 return out.sort();
}
export function writeNativeArtifact(root,{sourceCommit,sourceTree,ciRunId,version}){
 if(!/^[a-f0-9]{40}$/.test(sourceCommit)||!/^[a-f0-9]{40}$/.test(sourceTree))throw Error('native_artifact_source_invalid');
 const rows=files(root).map(name=>{const bytes=fs.readFileSync(path.join(root,name));return {path:name,bytes:bytes.length,sha256:sha(bytes)};});
 if(rows.length<2||rows.length>128||!rows.some(x=>x.path==='helper/LightRemote.RM.exe')||!rows.some(x=>x.path==='fixture/LightRemote.RM.TextFixture.exe'))throw Error('native_artifact_executables_missing');
 const manifest={schemaVersion:1,kind:'same-source-rmv2-native-test-and-product',sourceCommit,sourceTree,ciRunId,version,files:rows};
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export function verifyNativeArtifact(root,{sourceCommit,sourceTree}){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(manifest.schemaVersion!==1||manifest.kind!=='same-source-rmv2-native-test-and-product'||manifest.sourceCommit!==sourceCommit||manifest.sourceTree!==sourceTree)throw Error('native_artifact_source_mismatch');
 if(!Array.isArray(manifest.files)||manifest.files.length<2||manifest.files.length>128)throw Error('native_artifact_manifest_invalid');
 const expected=manifest.files.map(row=>row.path).sort();const actual=files(root);
 if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('native_artifact_file_set_mismatch');
 if(!actual.includes('helper/LightRemote.RM.exe')||!actual.includes('fixture/LightRemote.RM.TextFixture.exe'))throw Error('native_artifact_executables_missing');
 for(const row of manifest.files){
  if(!/^(helper|fixture)\/[A-Za-z0-9_.\/-]+$/.test(row.path)||row.path.includes('..'))throw Error('native_artifact_path_invalid');
  const target=path.resolve(root,row.path);if(!target.startsWith(path.resolve(root)+path.sep))throw Error('native_artifact_path_escape');
  const bytes=fs.readFileSync(target);if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('native_artifact_hash_mismatch');
 }
 return manifest;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [mode,root,sourceCommit,sourceTree,ciRunId,version]=process.argv.slice(2);if(!['write','verify'].includes(mode))throw Error('native_artifact_mode');
 const manifest=mode==='write'?writeNativeArtifact(root,{sourceCommit,sourceTree,ciRunId,version}):verifyNativeArtifact(root,{sourceCommit,sourceTree});
 console.log(JSON.stringify({result:'PASS',mode,sourceCommit:manifest.sourceCommit,files:manifest.files.length,helperSha256:manifest.files.find(row=>row.path==='helper/LightRemote.RM.exe').sha256}));
}
