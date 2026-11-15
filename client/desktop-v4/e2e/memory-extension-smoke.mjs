import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'),ext=path.join(root,'extensions/light-remote-lm-abv2');
const output=path.join(process.env.LR_V4_VISUAL_OUT??path.join(root,'build-output'),'memory-extension-browser');await fs.mkdir(output,{recursive:true});
const scripts=await Promise.all(['capture.js','restore.js','wall.js'].map(name=>fs.readFile(path.join(ext,name),'utf8')));
const browser=await chromium.launch({headless:true});const results=[];
try{
 const context=await browser.newContext();
 // Every request is synthetic; no provider, local service or Owner account is contacted.
 let fixture='';
 await context.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}):route.abort());
 const page=await context.newPage();
 for(const provider of ['chatgpt','claude']){
  const chat=provider==='chatgpt',url=chat?'https://chatgpt.com/c/memory-fixture':'https://claude.ai/chat/memory-fixture';
  fixture='<!doctype html><meta charset="utf-8"><main>'+(chat?'<div data-message-author-role="user">Question</div><div data-message-author-role="assistant">':'<div data-testid="user-message">Question</div><div data-is-streaming="false">')+
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
  assert.equal(stage.ok,true);assert.equal(stage.submitted,false);assert.equal(await page.locator(selector).innerText(),'New context 😀\n    code');
  await page.screenshot({path:path.join(output,provider+'-restored-draft.png')});results.push({provider,capture:'PASS',hiddenAncestor:'EXCLUDED',multipleBlocks:'PRESERVED',draft:'PRESERVED',inserted:'PASS',autoSubmit:false});
 }
 await context.close();
}finally{
 await browser.close();await fs.writeFile(path.join(output,'evidence.json'),JSON.stringify({scope:'Real Chromium DOM fixtures; no actual provider/account/MV3 installation or permissions acceptance',results},null,2)+'\n');
}
console.log('MEMORY_EXTENSION_BROWSER_DOM_PASS '+results.length+' providers; no network or Owner profile');
