import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),ext=path.join(root,'extensions/light-remote-lm-abv2');
const output=path.join(process.env.LR_V4_VISUAL_OUT??path.join(root,'build-output'),'memory-extension-browser');await fs.mkdir(output,{recursive:true});
const scripts=await Promise.all(['capture.js','restore.js','wall.js'].map(name=>fs.readFile(path.join(ext,name),'utf8')));
const browser=await chromium.launch({headless:true,executablePath:process.env.LR_MEMORY_PAIR_CHROME});const results=[];
try{
 const context=await browser.newContext();
 // Every request is synthetic; no provider, local service or Owner account is contacted.
 let fixture='';
 await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}):route.abort());
 const page=await context.newPage();
 for(const provider of ['chatgpt','claude']){
  const chat=provider==='chatgpt',url=chat?'https://chatgpt.com/c/memory-fixture':'https://claude.ai/chat/memory-fixture';
  fixture='<!doctype html><meta charset="utf-8"><style>[contenteditable]{white-space:pre-wrap}</style><main>'+(chat?'<div data-message-author-role="user">Question</div><div data-message-author-role="assistant">':'<div data-testid="user-message">Question</div><div data-is-streaming="false">')+
   '<div class="markdown">First block<pre>    code 😀\n\tsecond line</pre></div><div class="markdown">Second block</div></div>'+
   '<div hidden>'+(chat?'<div data-message-author-role="assistant">':'<div data-testid="assistant-message">')+'HIDDEN_SECRET</div></div>'+
   (chat?'<div id="prompt-textarea" contenteditable="true" role="textbox"><p>Owner unsent draft</p></div>':'<div class="ProseMirror" contenteditable="true" role="textbox"><p>Owner unsent draft</p></div>')+'</main>';
  await page.goto(url);for(const content of scripts)await page.addScriptTag({content});
  const capture=await page.evaluate(()=>lightRemoteLmCaptureSegment());
  await fs.writeFile(path.join(output,provider+'-synthetic-capture.json'),JSON.stringify(capture,null,2)+'\n');
  assert.equal(capture.ok,true);assert.equal(capture.turns,2);assert.equal(capture.provider,provider);
  assert.ok(capture.chunk.includes('    code 😀'),JSON.stringify(capture.chunk));assert.ok(capture.chunk.includes('Second block'));assert.ok(!capture.chunk.includes('HIDDEN_SECRET'));
  assert.equal((await page.evaluate(url=>lightRemoteLmStageComposer('New context 😀\n    code',url),url)).error,'draft_not_empty');
  const selector=chat?'#prompt-textarea':'.ProseMirror';
  assert.equal(await page.locator(selector).innerText(),'Owner unsent draft');
  await page.locator(selector).fill('');
  const stage=await page.evaluate(url=>lightRemoteLmStageComposer('New context 😀\n    code',url),url);
  await fs.writeFile(path.join(output,provider+'-stage-result.json'),JSON.stringify({stage,readback:await page.locator(selector).innerText(),html:await page.locator(selector).innerHTML()},null,2)+'\n');
  assert.equal(stage.ok,true);assert.equal(stage.submitted,false);assert.equal(await page.locator(selector).locator('p').allTextContents().then(p=>p.join('\n')),'New context 😀\n    code');
  await page.screenshot({path:path.join(output,provider+'-restored-draft.png')});results.push({provider,capture:'PASS',hiddenAncestor:'EXCLUDED',multipleBlocks:'PRESERVED',draft:'PRESERVED',inserted:'PASS',autoSubmit:false});
 }
 const updatedChat='https://chatgpt.com/g/fixture-gpt/c/memory-fixture?transient=ignored';
 fixture=`<!doctype html><html><meta charset="utf-8"><div role="main">
   <nav><div data-user-message-bubble="true">EXCLUDED_NAV</div></nav>
   <div data-thread-find-target="conversation">
     <div data-turn-key="first">
       <div data-chatgpt-search-unit-key="first:0:user"><div data-user-message-bubble="true">First user</div></div>
       <div data-chatgpt-search-unit-key="first:1:assistant">
         <h4 data-conversation-role="assistant">EXCLUDED_ROLE_LABEL</h4>
         <div data-markdown-text-style="assistant-message"><p>First assistant<span aria-hidden="true">EXCLUDED_ARIA</span></p><pre>    code 😀\n\tline<button>EXCLUDED_COPY</button></pre></div>
         <div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">EXCLUDED_STATUS</div>
         <div data-markdown-text-style="assistant-message"><p>Second response block</p></div>
         <div data-chatgpt-search-unit-key="first:2:tool"><div data-markdown-text-style="assistant-message">EXCLUDED_TOOL</div></div>
       </div>
     </div>
     <section data-turn="user"><div data-message-author-role="user">Legacy user</div></section>
     <section data-turn="assistant"><div class="markdown">Legacy reply</div></section>
     <div data-turn-key="two"><div data-user-message-bubble="true">Last user</div>
       <div data-markdown-text-style="assistant-message"><div data-markdown-text-style="assistant-message">Last reply</div></div>
       <div data-markdown-text-style="assistant-message">Continuation</div>
       <div hidden><div data-user-message-bubble="true">EXCLUDED_HIDDEN</div></div>
     </div>
     <div data-turn-key="not-loaded"></div>
   </div>
   <div data-markdown-text-style="assistant-message">EXCLUDED_OUTSIDE_THREAD</div>
   <div contenteditable="true">EXCLUDED_DRAFT</div>
 </div></html>`;
 await page.goto(updatedChat);
 await page.addScriptTag({content:scripts[0]});
 const modern=await page.evaluate(()=>lightRemoteLmCaptureSegment());
 assert.equal(modern.ok,true);
 assert.equal(modern.turns,6);
 assert.equal(modern.conversationId,'memory-fixture');
 assert.equal(modern.sourceUrl,updatedChat.split('?')[0]);
 assert.match(modern.chunk,/First user[\s\S]+First assistant[\s\S]+Second response block[\s\S]+Legacy user[\s\S]+Legacy reply[\s\S]+Last user[\s\S]+Last reply[\s\S]+Continuation/);
 assert.match(modern.chunk,/    code 😀\n\tline/);
 assert.doesNotMatch(modern.chunk,/EXCLUDED_/);
 assert.equal(modern.chunk.split('Last reply').length,2);
 const original=modern.sha256;
 await page.locator('[data-user-message-bubble]').filter({hasText:'First user'}).evaluate(el=>{el.textContent='Updated user';});
 assert.equal((await page.evaluate(sha=>lightRemoteLmCaptureSegment({expectedSha256:sha}),original)).stale,true);
 results.push({provider:'chatgpt',layout:'search-units-and-legacy',capture:'PASS',turnOrder:'PRESERVED',hiddenAndControls:'EXCLUDED',duplicates:'EXCLUDED',snapshotChanged:'REJECTED'});

 fixture='<!doctype html><main><div data-markdown-text-style="assistant-message">Unrelated content</div><div contenteditable="true">Unsent draft</div></main>';
 await page.goto('https://chatgpt.com/');
 await page.addScriptTag({content:scripts[0]});
 assert.match((await page.evaluate(()=>lightRemoteLmCaptureSegment())).error,/No supported loaded messages/);
 await context.close();
}finally{
 await browser.close();await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify({scope:'Real Chromium DOM fixtures; no actual provider/account/MV3 installation or permissions acceptance',results},null,2)+'\n');
}
console.log('MEMORY_EXTENSION_BROWSER_DOM_PASS '+results.length+' fixtures; no network or Owner profile');
