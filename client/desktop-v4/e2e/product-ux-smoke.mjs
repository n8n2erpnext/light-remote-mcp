#!/usr/bin/env node
// Populated, strictly synthetic browser QA. Never talks to a real Owner/Agent.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=process.env.LR_V4_VISUAL_OUT?path.join(process.env.LR_V4_VISUAL_OUT,'populated'):path.join(root,'visual-evidence','populated');
const port=4175,url=`http://127.0.0.1:${port}/e2e/fixtures/user-experience.html`;
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['./node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,VITE_LR_V4_UI_TEST:'1',VITE_LR_V4_OWNER_LOGIN:'1',VITE_LR_V4_NATIVE_WINDOWS:'1'}});
let serverLog='';server.stdout.on('data',d=>{serverLog=String(d).slice(-2000);});server.stderr.on('data',d=>{serverLog+=String(d).slice(-2000);});
let browser;const results=[];
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(url)).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('Fixture server unavailable: '+serverLog);}
const variants=[{width:1280,height:800,dpr:1,name:'desktop'},{width:1280,height:800,dpr:1.5,name:'windows-150-percent'},{width:853,height:650,dpr:1.5,name:'small-window-150-percent'},{width:1024,height:768,dpr:1,name:'small-desktop'},{width:768,height:900,dpr:1,name:'tablet'},{width:390,height:844,dpr:1,name:'narrow'}];
const routes=['overview','ai-access','sessions','live-monitor','devices','long-memory','codex-bridge','account','settings','login','consent'];
try{
 await ready();browser=await chromium.launch({headless:true,...(process.env.LR_PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.LR_PLAYWRIGHT_EXECUTABLE}:{}),args:['--no-sandbox']});
 for(const theme of (process.env.LR_UX_THEME?[process.env.LR_UX_THEME]:['light','dark']))for(const variant of variants.filter(v=>!process.env.LR_UX_VARIANT||v.name===process.env.LR_UX_VARIANT)){
  const context=await browser.newContext({viewport:{width:variant.width,height:variant.height},deviceScaleFactor:variant.dpr,colorScheme:theme});
  const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
  for(const screen of routes.filter(r=>!process.env.LR_UX_ROUTE||r===process.env.LR_UX_ROUTE)){
   const key=`${screen}-${theme}-${variant.name}`;
   await page.goto(`${url}?route=${screen}&theme=${theme}&long=1`,{waitUntil:'networkidle'});
   if(screen!=='consent')await page.locator(screen==='login'?'.auth-card':'.main-area').waitFor();
   await page.evaluate(async()=>{await document.fonts.ready;});
   if(['long-memory','codex-bridge','settings'].includes(screen))await page.locator('.native-module-screen,.settings-column').waitFor();
   if(screen==='long-memory')await page.getByRole('heading',{name:'Website redesign',exact:true}).waitFor();
   if(screen==='codex-bridge')await page.getByText('Review the complete checkout and subscription settings workflow for returning customers',{exact:true}).waitFor();
   if(screen==='settings')await page.getByText('0.10.1-dev.7',{exact:true}).waitFor();
   const metrics=await page.evaluate(()=>{
    const bad=Array.from(document.querySelectorAll('.lr-card,.page-header,.sidebar,.auth-card,.consent-card,.native-confirm,.device-link-modal')).filter(x=>x.scrollWidth>x.clientWidth+3).map(x=>x.className);
    const input=document.querySelector('input[placeholder="XXXX-XXXX"]'),button=document.querySelector('.approval-request button[type="submit"]');
    const i=input?.getBoundingClientRect(),b=button?.getBoundingClientRect();
    const overlap=Boolean(i&&b&&Math.min(i.right,b.right)>Math.max(i.left,b.left)&&Math.min(i.bottom,b.bottom)>Math.max(i.top,b.top));
    const cells=Array.from(document.querySelectorAll('tbody td:not([colspan])'));
    return {horizontalOverflow:document.documentElement.scrollWidth>innerWidth+3,overflowing:bad,approvalInputOverlapped:overlap,
     minimumCellPadding:cells.length?Math.min(...cells.map(x=>parseFloat(getComputedStyle(x).paddingTop))):null,
     logoLoaded:Array.from(document.querySelectorAll('.brand img,.auth-brand-lockup img')).every(img=>img.complete&&img.naturalWidth>0),
     taskRows:document.querySelectorAll('.monitor-jobs tbody tr').length,
     inputRect:i?{x:i.x,y:i.y,w:i.width,h:i.height}:null,buttonRect:b?{x:b.x,y:b.y,w:b.width,h:b.height}:null};
   });
   // A populated table and a real B form are checked, not just empty placeholders.
   if(!metrics.logoLoaded||metrics.horizontalOverflow||metrics.overflowing.length||metrics.approvalInputOverlapped||(metrics.minimumCellPadding!==null&&metrics.minimumCellPadding<10)||errors.length){await page.screenshot({path:path.join(out,key+'-FAILED.png'),fullPage:true});throw Error(key+' '+JSON.stringify({metrics,errors}));}
   if(screen==='live-monitor'){
    if(metrics.taskRows!==10)throw Error('Task history must initially render10 of120 loaded rows');
    await page.getByRole('button',{name:'Needs attention',exact:true}).click();
    const states=await page.locator('.monitor-jobs tbody .product-badge').allTextContents();
    if(!states.length||states.some(x=>!['Failed','Timed out','Stopped'].includes(x)))throw Error('Task issue filter failed');
    await page.getByRole('button',{name:'All tasks',exact:true}).click();
    await page.locator('.monitor-jobs details').first().locator('summary').click();
    await page.getByText('synthetic-job-00000000',{exact:true}).waitFor();
    await page.locator('.monitor-jobs details').first().locator('summary').click();
   }
   if(screen==='ai-access'){
    const field=page.getByRole('textbox',{name:'Agent B code',exact:true}),approve=page.getByRole('button',{name:'Approve Agent',exact:true});
    if(!await approve.isDisabled())throw Error('Empty B must not approve');
    await field.fill('WEW7-NNBU');if(!await approve.isEnabled())throw Error('Valid B must enable approval');
    // Calibrate the detector by deliberately placing the submit button over
    // its input. The new normal-flow DOM is more resilient than the old DOM.
    await page.evaluate(()=>{const a=document.querySelector('input[placeholder="XXXX-XXXX"]').getBoundingClientRect(),el=document.querySelector('.approval-request button[type="submit"]'),b=el.getBoundingClientRect();el.style.transform=`translateY(${a.top-b.top}px)`;});
    const caught=await page.evaluate(()=>{const a=document.querySelector('input[placeholder="XXXX-XXXX"]').getBoundingClientRect(),b=document.querySelector('.approval-request button[type="submit"]').getBoundingClientRect();return Math.min(a.right,b.right)>Math.max(a.left,b.left)&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top);});
    await page.evaluate(()=>{document.querySelector('.approval-request button[type="submit"]').style.transform='';});
    if(!caught)throw Error('Overlap detector missed deliberately intersecting button/input');
   }
   if(variant.name==='desktop'||variant.name==='windows-150-percent'||variant.name==='narrow')await page.screenshot({path:path.join(out,key+'.png'),fullPage:true,animations:'disabled'});
   results.push({screen,theme,variant:variant.name,passed:true,...metrics});
   console.log('PASS '+key);
  }
  if(variant.name==='desktop'||variant.name==='narrow')for(const dialog of ['link','confirm']){
   await page.goto(`${url}?route=devices&theme=${theme}&dialog=${dialog}`,{waitUntil:'networkidle'});await page.getByRole('dialog').waitFor();
   const box=await page.getByRole('dialog').boundingBox();if(!box||box.x<0||box.x+box.width>variant.width+2)throw Error('Dialog viewport overflow');
   await page.screenshot({path:path.join(out,`${dialog}-${theme}-${variant.name}.png`),fullPage:true});
   await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
   results.push({dialog,theme,variant:variant.name,passed:true});
  }
  await context.close();
 }
 // This test fixture must not become a production app route or bundle payload.
 const dist=path.join(root,'dist');for(const name of await readdir(path.join(dist,'assets'))){if(name.endsWith('.js')&&(await readFile(path.join(dist,'assets',name),'utf8')).includes('LIGHT_REMOTE_UX_FIXTURE_ONLY'))throw Error('Synthetic fixture in production bundle');}
}finally{
 await writeFile(path.join(out,'evidence.json'),JSON.stringify({date:new Date().toISOString(),scope:'Synthetic populated browser UX; not physical Owner acceptance',results},null,2)+'\n');await browser?.close();server.kill('SIGTERM');
}
