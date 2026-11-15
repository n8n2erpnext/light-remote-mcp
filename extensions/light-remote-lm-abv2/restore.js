'use strict';
function lightRemoteLmStageComposer(text,expectedUrl){
 const u=new URL(location.href),before=u.origin+u.pathname;
 if(before!==expectedUrl||u.protocol!=='https:'||!['chatgpt.com','claude.ai'].includes(u.hostname))return {ok:false,error:'conversation_changed'};
 if(typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).byteLength>512*1024)return {ok:false,error:'context_invalid'};
 const selectors=u.hostname==='chatgpt.com'?'#prompt-textarea':'main [contenteditable="true"].ProseMirror,main [contenteditable="true"][role="textbox"],main textarea';
 const candidates=[...document.querySelectorAll(selectors)].filter(el=>{
  if(el.disabled||el.readOnly||el.closest('[hidden],[inert],[aria-hidden="true"]'))return false;
  const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0;
 });
 if(candidates.length!==1)return {ok:false,error:'composer_not_identified'};
 const el=candidates[0],read=()=>String(el.tagName==='TEXTAREA'?el.value:el.innerText??el.textContent??'');
 if(read().trim()||String(el.textContent??'').trim())return {ok:false,error:'draft_not_empty'};
 el.focus();
 if(el.tagName==='TEXTAREA'){
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,text);
  el.dispatchEvent(new Event('input',{bubbles:true}));
 }else{
  const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  if(!document.execCommand('insertText',false,text))return {ok:false,error:'composer_requires_manual_paste'};
 }
 if(read().replace(/\r/g,'').trimEnd()!==text.replace(/\r/g,'').trimEnd())return {ok:false,error:'review_partial_draft_do_not_retry'};
 // Never synthesize Enter, submit, click Send or continue a web turn.
 return {ok:true,submitted:false};
}
