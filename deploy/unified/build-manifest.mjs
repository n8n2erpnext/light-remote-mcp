import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error('build_git_unavailable');return r.stdout.trim();};
const args=process.argv.slice(2),allowed=new Set(['--out','--platform','--artifact']);
const options={};for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||options[args[i]])throw Error('build_manifest_arguments_invalid');options[args[i]]=args[i+1];}
const out=options['--out'];if(!out||!options['--platform'])throw Error('build_manifest_arguments_required');
const commit=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
const drift=git('status','--porcelain','--untracked-files=no');
if(!/^[a-f0-9]{40}$/.test(commit)||drift){
 console.error('UNIFIED_TRACKED_SOURCE_DRIFT='+drift);
 throw Error('build_clean_exact_commit_required');
}
const project=JSON.parse(fs.readFileSync(path.join(root,'project.manifest.json'),'utf8'));
const lockPaths=['package-lock.json','plugin-server/package-lock.json','client/desktop-v4/package-lock.json','client/desktop-v4/src-tauri/Cargo.lock','platform-v2/sql/migrations.lock.json','config/endpoints.json'];
const sha=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
const dependencyHashes={};for(const p of lockPaths)dependencyHashes[p]=await sha(path.join(root,p));
const artifact=options['--artifact']?path.resolve(options['--artifact']):null;
if(artifact&&(!fs.statSync(artifact).isFile()||fs.lstatSync(artifact).isSymbolicLink()))throw Error('build_artifact_invalid');
const manifest={schemaVersion:1,project:project.project,projectVersion:project.version,repository:project.repository,
 sourceCommit:commit,sourceTree:tree,buildTimestamp:new Date().toISOString(),ciRunId:process.env.GITHUB_RUN_ID||null,
 ciRepository:process.env.GITHUB_REPOSITORY||null,platform:options['--platform'],apiContractVersion:project.apiContractVersion,
 featureProfile:project.defaultBuildProfile,componentVersions:{agent:project.version,plugin:project.version,operator:project.version,wall:project.version,desktop:project.version},
 schema:{coreThrough:project.database.coreThrough,extensions:project.database.extensions.map(x=>({id:x.id,sha256:x.sha256}))},dependencyHashes,
 artifact:artifact?{name:path.basename(artifact),bytes:fs.statSync(artifact).size,sha256:await sha(artifact)}:null,
 assurances:{cleanGitSource:true,sourceSelection:'MIGRATION_PROVENANCE.json',codeSigningVerified:false,physicalAcceptance:false,productionRelease:false}};
fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(manifest,null,2)+'\n');
console.log('UNIFIED_BUILD_MANIFEST='+JSON.stringify({sourceCommit:commit,sourceTree:tree,platform:manifest.platform,artifact:manifest.artifact}));
