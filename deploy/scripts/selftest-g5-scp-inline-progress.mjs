import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {startLocalWall} from '../../device-agent/local-wall.mjs';
import {loadLocalWallAuth,writeLocalWallAuthConfig} from '../../device-agent/local-wall-auth.mjs';
import {createNativeActivityFormatter} from '../../operator-host/executor-native-activity.mjs';

const fmt=createNativeActivityFormatter({redact:x=>x});
const root=fs.mkdtempSync(path.join(os.tmpdir(),'lr-g5-inline-'));
const authFile=path.join(root,'auth.json');
writeLocalWallAuthConfig(authFile,{username:'fixture',password:'g5-inline-password-fixture',sessionTtlSeconds:3600});
const auth=loadLocalWallAuth(authFile,{required:true});
const events=[],now=Date.now()-30000;
const mk=(id,request,data,status='ok')=>{
 const meta=fmt.scpActivityMeta(request);
 const common={jobId:id,sessionId:'s_g5fixture',agentId:'agent_g5fixture',cwd:'',script:'',note:'light-scp:'+request.op,toolMeta:meta};
 events.push({...common,type:'job_started',id:id+'-start',at:now+events.length*5,status:'running'});
 events.push({...common,type:'job_finished',id:id+'-done',at:now+events.length*5,status,exitCode:status==='ok'?0:1,resultSummary:fmt.nativeActivityResult(meta,data)});
};
const total=262144,transferId='lscp_g5_inline_fixture';
const transfer=(op,bytes,chunks)=>({ok:true,operation:op,transfer:{id:transferId,mode:op.startsWith('download')?'download':'upload',progressBytes:bytes,totalBytes:total,progressChunks:chunks,totalChunks:4,complete:bytes===total}});
mk('g5_begin',{op:'upload-begin',destination:'/tmp/test.bin',totalBytes:total},transfer('upload-begin',0,0));
mk('g5_up_50',{op:'upload-chunk',transferId,index:1},transfer('upload-chunk',131072,2));
mk('g5_up_75',{op:'upload-chunk',transferId,index:2},transfer('upload-chunk',196608,3));
mk('g5_up_100',{op:'upload-chunk',transferId,index:3},transfer('upload-chunk',total,4));
mk('g5_commit',{op:'upload-commit',transferId},{ok:true,operation:'upload-commit',result:{id:transferId,mode:'upload',totalBytes:total,path:'/tmp/test.bin'}});
mk('g5_down_75',{op:'download-chunk',transferId,index:2},transfer('download-chunk',196608,3));
mk('g5_down_100',{op:'download-chunk',transferId,index:3},transfer('download-chunk',total,4));
mk('g5_down_old',{op:'download-chunk',transferId,index:0},{ok:true,operation:'download-chunk',chunk:{bytes:65536,complete:false}});
mk('g5_error',{op:'upload-chunk',transferId,index:7},{ok:false,error:'scp_chunk_invalid'},'error');
const port=33000+process.pid%11000;
const wall=startLocalWall({host:'127.0.0.1',port,auth,brandSvgPath:new URL('../../assets/branding/light-remote-mark.svg',import.meta.url).pathname,
 getLocalStatus:async()=>({deviceName:'G5 inline Fixture',enrolled:true,cloudState:'connected',cloudDesiredConnected:true}),
 getRemoteStatus:async()=>({sessions:[]}),getRemoteActivity:async()=>({events}),
});
let browser;
try{
 const base='http://127.0.0.1:'+port;
 let r=await fetch(base+'/api/scp/transfers',{redirect:'manual'});
 assert.notEqual(r.status,200,'obsolete SCP progress API must not be exposed');
 const pw=await import('playwright').catch(()=>null);
 if(!pw||!fs.existsSync(pw.chromium.executablePath())){console.log('G5_INLINE_PROGRESS_BROWSER=SKIPPED');process.exitCode=2;}
 else{
  browser=await pw.chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1590,height:1000}});
  await page.goto(base+'/login');
  await page.locator('input[name=username]').fill('fixture');
  await page.locator('input[name=password]').fill('g5-inline-password-fixture');
  await page.locator('button[type=submit]').click();
  await page.waitForURL(base+'/');
  await page.locator('#j-g5_down_75 .scp-inline-progress').waitFor({timeout:12000});
  assert.equal(await page.locator('#scpProgress,.scp-progress,.scp-entry,.scp-meter').count(),0,'remove separate SCP panel');
  assert.equal(await page.locator('.scp-inline-progress').count(),7,'only 7 precise valid SCP events show progress');
  for(const [job,fragment] of [
   ['g5_begin','[----------------] 0%'],['g5_up_50','[########--------] 50%'],
   ['g5_up_75','[############----] 75%'],['g5_up_100','[################] 100%'],
   ['g5_commit','[################] 100%'],['g5_down_75','[############----] 75%'],
   ['g5_down_100','[################] 100%']
  ]){
   const entry=page.locator('#j-'+job),line=entry.locator('.scp-inline-progress');
   assert.ok((await line.innerText()).includes(fragment),job+' must show own historical percentage');
   assert.equal(await entry.locator('.cmdwrap > span .scp-inline-progress').count(),1,'progress adjacent to inline command');
  }
  assert.match(await page.locator('#j-g5_up_100').innerText(),/awaiting commit/);
  assert.match(await page.locator('#j-g5_commit').innerText(),/SHA-256 verified/);
  assert.match(await page.locator('#j-g5_down_100').innerText(),/receiver unconfirmed/);
  assert.equal(await page.locator('#j-g5_down_old .scp-inline-progress').count(),0,'no guessed percent on legacy event');
  assert.equal(await page.locator('#j-g5_error .scp-inline-progress').count(),0,'failed chunk must not show success percent');
  assert.equal(await page.locator('#j-g5_up_50 .scp-inline-progress').count(),1,'older chunk remains 50%, never overwritten by subsequent status');
  await page.reload();await page.locator('#j-g5_down_75 .scp-inline-progress').waitFor();
  assert.match(await page.locator('#j-g5_up_50').innerText(),/50%/);
  assert.equal(await page.locator('.scp-progress').count(),0);
  console.log('G5_SCP_INLINE_0_50_75_100_AND_COMMIT=PASS');
  console.log('G5_SCP_INLINE_HISTORICAL_PER_JOB_NO_FAKE_PROGRESS=PASS');
  console.log('G5_SCP_INLINE_NO_PANEL_NO_POLLING=PASS');
 }
}finally{if(browser)await browser.close();await wall.close();fs.rmSync(root,{recursive:true,force:true});}
