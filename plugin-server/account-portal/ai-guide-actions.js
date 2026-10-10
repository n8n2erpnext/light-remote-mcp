(()=>{
  'use strict';
  const link=()=>location.origin+'/ai-guide';
  const source=document.getElementById('lightRemoteAiGuideSource');
  const markdown=(()=>{
    try {
      const text=JSON.parse(source?.textContent||'{}').markdown;
      return typeof text==='string'&&text.startsWith('# Light Remote — Complete AI Guide')&&text.length>10000?text:null;
    } catch {return null;}
  })();
  const prompt=()=>[
    'I am asking about Light Remote. The COMPLETE official AI Guide is included below.',
    'Read the embedded instructions and help me with installation, device enrollment, A/B pairing, tools, security or troubleshooting.',
    'Do not depend on opening the URL. Ask one relevant next question at a time.',
    'Never claim to control a device without an authorized connected Light Remote plugin and a successful Local Wall A/B approval.',
    'Check current official release details before giving version-specific instructions.',
    'Source URL (optional reference only): '+link(),
    '\n===== BEGIN LIGHT REMOTE AI GUIDE =====\n',
    markdown,
    '\n===== END LIGHT REMOTE AI GUIDE ====='
  ].join('\n');
  async function copy(text){
    if(navigator.clipboard?.writeText){
      try {await navigator.clipboard.writeText(text);return true;} catch {}
    }
    const input=document.createElement('textarea');
    input.value=text;
    input.setAttribute('aria-label','Light Remote AI Guide to copy');
    input.style.cssText='position:fixed;left:0;top:0;opacity:0;width:1px;height:1px';
    document.body.append(input);
    input.focus();input.select();
    let ok=false;try {ok=document.execCommand('copy');} catch {}
    input.remove();
    return ok;
  }
  function manualCopy(text){
    const overlay=document.createElement('dialog');
    overlay.setAttribute('aria-label','Copy Light Remote AI Guide manually');
    overlay.style.cssText='width:min(92vw,760px);max-height:85vh;background:#111821;color:#fff;border:1px solid #56616f;border-radius:12px;padding:20px';
    const title=document.createElement('h2');title.textContent='Select and copy the AI Guide';
    const hint=document.createElement('p');hint.textContent='Your browser blocked clipboard access. Copy the selected text, then paste it into your AI chat.';
    const area=document.createElement('textarea');area.readOnly=true;area.value=text;
    area.style.cssText='width:100%;height:48vh;box-sizing:border-box;white-space:pre-wrap;background:#0b1016;color:#fff;border:1px solid #677383;padding:12px';
    const close=document.createElement('button');close.type='button';close.textContent='Close';close.style.cssText='display:block;margin-top:12px;padding:9px 20px';
    close.addEventListener('click',()=>overlay.close());
    overlay.append(title,hint,area,close);document.body.append(overlay);
    overlay.addEventListener('close',()=>overlay.remove(),{once:true});
    if(typeof overlay.showModal==='function')overlay.showModal();else overlay.setAttribute('open','');
    area.focus();area.select();
  }
  document.addEventListener('click',async event=>{
    const btn=event.target.closest('[data-copy-ai]');
    if(!btn)return;
    const full=btn.dataset.copyAi==='prompt';
    const target=btn.closest('.home-ai-guide')?.querySelector('.home-ai-guide-status')||
      document.getElementById('aiGuideCopyStatus');
    if(full&&!markdown){
      if(target)target.textContent='The complete guide is unavailable. Open AI-readable Markdown instead; no incomplete prompt was copied.';
      return;
    }
    const value=full?prompt():link();
    const before=btn.textContent;btn.disabled=true;
    const ok=await copy(value);
    btn.disabled=false;
    if(ok){
      if(target)target.textContent=full
        ?'Complete guide copied ('+markdown.length.toLocaleString()+' characters). Paste it into ChatGPT or another AI. Web access is NOT required.'
        :'Link copied. Some AI tools cannot open URLs; use Copy Complete Guide if your assistant cannot read the link.';
      btn.textContent='Copied!';
      setTimeout(()=>btn.textContent=before,2200);
    }else{
      if(target)target.textContent='Clipboard access was blocked. A selectable text window is open for manual copying.';
      manualCopy(value);
    }
  });
})();