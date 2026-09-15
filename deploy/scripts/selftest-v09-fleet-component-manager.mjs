import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {FleetComponentManager} from '../../device-agent/fleet-component-manager.mjs';

const root=path.resolve(new URL('../..',import.meta.url).pathname),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'lr-fleet-component-'));
const packageDir=path.join(tmp,'src','fleet-wall');fs.mkdirSync(path.join(packageDir,'device-agent'),{recursive:true});fs.mkdirSync(path.join(packageDir,'lib'),{recursive:true});fs.mkdirSync(path.join(packageDir,'gateway'),{recursive:true});fs.mkdirSync(path.join(packageDir,'assets','branding'),{recursive:true});
for(const [src,dst] of [['device-agent/fleet-wall-runtime.mjs','device-agent/fleet-wall-runtime.mjs'],['device-agent/local-wall-auth.mjs','device-agent/local-wall-auth.mjs'],['lib/device-proof.mjs','lib/device-proof.mjs'],['lib/runtime-version.mjs','lib/runtime-version.mjs'],['lib/brand.mjs','lib/brand.mjs'],['gateway/dashboard.mjs','gateway/dashboard.mjs'],['gateway/device-policy-page.mjs','gateway/device-policy-page.mjs'],['gateway/brand.mjs','gateway/brand.mjs'],['assets/branding/light-remote-mark.svg','assets/branding/light-remote-mark.svg']])fs.copyFileSync(path.join(root,src),path.join(packageDir,dst));
fs.writeFileSync(path.join(packageDir,'manifest.json'),JSON.stringify({component:'fleet-wall',version:'0.9.0-rc.6'},null,2));
const archive=path.join(tmp,'fleet-wall.tar.gz'),tar=spawnSync('tar',['-czf',archive,'-C',path.join(tmp,'src'),'fleet-wall'],{encoding:'utf8'});if(tar.status!==0)throw new Error(`tar_failed:${tar.stderr}`);
const artifact=fs.readFileSync(archive),sha256=crypto.createHash('sha256').update(artifact).digest('hex');
const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}),publicKeyFile=path.join(tmp,'update-public.pem');fs.writeFileSync(publicKeyFile,publicKey.export({format:'pem',type:'spki'}));
let artifactHits=0,badSignature=false,badSha=false;
const server=http.createServer((req,res)=>{
  const base=`http://127.0.0.1:${server.address().port}`;
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,component:'fleet-wall',version:'0.9.0-rc.6',artifact:{url:`${base}/fleet-wall.tar.gz`,sha256:badSha?'0'.repeat(64):sha256,size:artifact.length}}));
  if(req.url==='/fleet-wall-module.json'){res.writeHead(200,{'content-type':'application/json','content-length':manifest.length});return res.end(manifest);}
  if(req.url==='/fleet-wall-module.json.sig'){const sig=badSignature?Buffer.from('bad').toString('base64'):crypto.sign('sha256',manifest,privateKey).toString('base64');return res.end(sig);}
  if(req.url==='/fleet-wall.tar.gz'){artifactHits++;res.writeHead(200,{'content-length':artifact.length});return res.end(artifact);}
  res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
function manager(name){return new FleetComponentManager({root:path.join(tmp,name),manifestUrl:`${base}/fleet-wall-module.json`,signatureUrl:`${base}/fleet-wall-module.json.sig`,publicKeyFile});}
async function expectFail(fn,message){let caught=null;try{await fn();}catch(error){caught=error;}if(!caught||caught.message!==message)throw new Error(`expected_${message}:${caught?.message||'none'}`);}
try{
  const good=manager('good'),first=await good.ensureInstalled();if(!first.installed||first.version!=='0.9.0-rc.6'||!fs.existsSync(first.runtime))throw new Error('fleet_component_install_failed');
  const hitsAfterFirst=artifactHits,second=await good.ensureInstalled();if(second.installed||artifactHits!==hitsAfterFirst)throw new Error('fleet_component_same_version_redownloaded');
  badSha=true;await expectFail(()=>manager('bad-sha').ensureInstalled(),'fleet_component_sha256_mismatch');badSha=false;
  badSignature=true;await expectFail(()=>manager('bad-signature').ensureInstalled(),'invalid_fleet_manifest_signature');badSignature=false;
  console.log('v09-fleet-component-signed-install=PASS');
  console.log('v09-fleet-component-current-pointer=PASS');
  console.log('v09-fleet-component-no-redownload=PASS');
  console.log('v09-fleet-component-sha-fail-closed=PASS');
  console.log('v09-fleet-component-signature-fail-closed=PASS');
}finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(tmp,{recursive:true,force:true});}
