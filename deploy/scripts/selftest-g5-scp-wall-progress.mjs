import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {LightScpRegistry} from '../../lib/light-scp-registry.mjs';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'g5-scp-wall-'));
const policy={readRoots:[root],writeRoots:[root],uploadRoots:[root],downloadRoots:[root]};
const reg=new LightScpRegistry({policy,ttlMs:30000});
const owner={accountId:'acct-g5',deviceId:'dev-g5',sessionId:'s_g5',agentId:'agent-g5'};
const bytes=Buffer.alloc(262144,65),sha=crypto.createHash('sha256').update(bytes).digest('hex');
const target=path.join(root,'g5-test.bin');
const up=await reg.beginUpload(owner,{destination:target,totalBytes:bytes.length,sha256:sha,chunkBytes:65536});
const view=async()=>await reg.wallSnapshot();
assert.equal((await view())[0].phase,'preparing');
for(let i=0;i<4;i++){
 await reg.putUploadChunk(owner,up.id,{index:i,data:bytes.subarray(i*65536,(i+1)*65536).toString('base64url')});
 const t=(await view())[0];
 assert.equal(t.progressBytes,65536*(i+1));
 assert.equal(t.progressChunks,i+1);
 assert.equal(t.phase,i===3?'verifying':'transferring');
 assert.equal(t.verified,false);
}
await reg.commitUpload(owner,up.id);
let t=(await view())[0];
assert.equal(t.phase,'completed');assert.equal(t.verified,true);
assert.equal('sha256' in t,false);assert.equal('destination' in t,false);
const dl=await reg.beginDownload(owner,{source:target,chunkBytes:65536});
for(let i=0;i<4;i++){
 await reg.readDownloadChunk(owner,dl.id,{index:i});
 t=(await view()).find(row=>row.transferId===dl.id);
 assert.equal(t.progressBytes,65536*(i+1));
 assert.equal(t.phase,i===3?'served':'transferring');
 assert.equal(t.verified,false,'served bytes are not proof of recipient persistence');
}
await reg.cancel(owner,dl.id);
assert.equal((await view()).find(row=>row.transferId===dl.id).phase,'cancelled');
assert.equal((await view()).length,2);
console.log('G5_SCP_REAL_BYTE_PROGRESS_UPLOAD_DOWNLOAD=PASS');
console.log('G5_SCP_COMPLETION_DISTINGUISHES_COMMIT_FROM_SERVED=PASS');
const authFile=path.join(root,'auth.json'),username='fixture',password='fixture-scp-progress-password';
writeLocalWallAuthConfig(authFile,{username,password,sessionTtlSeconds:3600});
const auth=loadLocalWallAuth(authFile,{required:true});
const port=32000+process.pid%12000;
let readCalls=0;
const server=startLocalWall({host:'127.0.0.1',port,auth,
 brandSvgPath:new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname,
 getLocalStatus:async()=>({deviceName:'G5 UAT',cloudState:'disconnected',enrolled:true}),
 getRemoteStatus:async()=>({sessions:[]}),getRemoteActivity:async()=>({events:[]}),
 getLocalScpTransfers:async()=>{readCalls++;return view();},
});
const base='http://127.0.0.1:'+port;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser=null;
try{
 const u=await fetch(base+'/api/scp/transfers',{redirect:'manual'});
 assert.equal(u.status,401);assert.equal(readCalls,0);
 const mod=await import('playwright').catch(()=>null);
 if(mod&&fs.existsSync(mod.chromium.executablePath())){
  browser=await mod.chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  await page.goto(base+'/login');
  await page.locator('input[name=username]').fill(username);
  await page.locator('input[name=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(base+'/');
  await page.locator('#scpRows .scp-entry').first().waitFor();
  const content=await page.locator('#scpRows').innerText();
  assert.match(content,/Upload/);assert.match(content,/Download/);
  assert.match(content,/100%/);assert.match(content,/SHA-256 verified and committed/);
  assert.match(content,/Transfer cancelled/);
  assert.doesNotMatch(content,/scp-progress-password|acct-g5|[a-f0-9]{64}/);
  const bars=await page.locator('#scpRows [role=progressbar]').count();
  assert.equal(bars,2);
  await page.reload();await page.locator('#scpRows .scp-entry').first().waitFor();
  assert.equal(await page.locator('#scpRows .scp-entry').count(),2);
  console.log('G5_AUTH_WALL_SCP_PROGRESS_CHROMIUM=PASS');
 }else console.log('G5_AUTH_WALL_SCP_PROGRESS_CHROMIUM=SKIPPED_NO_BROWSER');
}finally{if(browser)await browser.close();await server.close();fs.rmSync(root,{recursive:true,force:true});}
