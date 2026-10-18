(()=>{
 const link=()=>location.origin+'/ai-guide';
 const starter=()=>['Read the official Light Remote AI Guide before helping me: '+link(),
 'I want to ask about Light Remote. Help me step by step, from installation and enrollment to local A/B pairing, features, security or troubleshooting.',
 'Ask only the next missing question, check the current release before stating details, and do not claim remote access or operate a device until the official helper reports ready.'].join(' ');
 async function copy(text){
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true;}catch{}}
  const t=document.createElement('textarea');t.value=text;t.style.cssText='position:fixed;left:-99999px;top:-99999px';document.body.append(t);t.select();let ok=false;try{ok=document.execCommand('copy');}catch{}t.remove();return ok;
 }
 document.addEventListener('click',async event=>{
  const btn=event.target.closest('[data-copy-ai]');if(!btn)return;
  const value=btn.dataset.copyAi==='url'?link():starter();
  const target=btn.closest('.home-ai-guide')?.querySelector('.home-ai-guide-status')||document.getElementById('aiGuideCopyStatus');
  const ok=await copy(value);
  if(target)target.textContent=ok?'Copied! Paste into ChatGPT to begin.':'Clipboard is unavailable. Open: '+link();
  if(ok){const before=btn.textContent;btn.textContent='Copied!';setTimeout(()=>btn.textContent=before,1800);}
 });
})();
