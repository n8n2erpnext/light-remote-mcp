const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const slugify = text => String(text).toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');
const inline = value => escapeHtml(value).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/https:\/\/[^\s<]+/g,url=>'<a href="'+url+'">'+url+'</a>');
export function renderGuideMarkdown(markdown){
 const out=[], lines=markdown.split(/\r?\n/);
 let paragraph=[], list=[], type='', pre=false, code=[], quote=[];
 const flush=()=>{
  if(paragraph.length){out.push('<p>'+inline(paragraph.join(' '))+'</p>');paragraph=[];}
  if(list.length){out.push('<'+type+'>'+list.map(x=>'<li>'+inline(x)+'</li>').join('')+'</'+type+'>');list=[];type='';}
  if(quote.length){out.push('<blockquote>'+inline(quote.join(' '))+'</blockquote>');quote=[];}
 };
 const cells=s=>s.trim().replace(/^\||\|$/g,'').split('|').map(v=>v.trim());
 for(let i=0;i<lines.length;i++){
  const s=lines[i].trim();
  if(s.startsWith('~~~')){if(pre){out.push('<pre><code>'+escapeHtml(code.join('\n'))+'</code></pre>');code=[];}else flush();pre=!pre;continue;}
  if(pre){code.push(lines[i]);continue;}
  if(!s){flush();continue;}
  const h=s.match(/^(#{1,3}) (.+)$/);
  if(h){flush();out.push('<h'+h[1].length+' id="'+slugify(h[2])+'">'+inline(h[2])+'</h'+h[1].length+'>');continue;}
  if(s.startsWith('| ')&&i+1<lines.length&&/^\|[\s|:-]+\|$/.test(lines[i+1].trim())){
   flush();const head=cells(s);i++;const rows=[];
   while(i+1<lines.length&&lines[i+1].trim().startsWith('|')){i++;rows.push('<tr>'+cells(lines[i]).map(x=>'<td>'+inline(x)+'</td>').join('')+'</tr>');}
   out.push('<div class="ai-table-scroll"><table><thead><tr>'+head.map(x=>'<th>'+inline(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>');continue;
  }
  if(s.startsWith('>')){flush();quote.push(s.slice(1).trim());continue;}
  const m=s.match(/^([-*]|\d+\.) (.+)$/);
  if(m){const k=/^\d/.test(m[1])?'ol':'ul';if(paragraph.length||k!==type)flush();type=k;list.push(m[2]);continue;}
  if(list.length)flush();paragraph.push(s);
 }
 flush();return out.join('\n');
}

// Embed the canonical Markdown in the page so Copy Complete Guide needs NO
// network fetch. Escape HTML-script sentinels to prevent markup injection.
export function embedAiGuideSource(html,markdown){
 const payload=JSON.stringify({markdown:String(markdown)}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
 const anchor='</body>';
 if(!html.includes(anchor))throw Error('ai_guide_embed_anchor_missing');
 return html.replace(anchor,'<script type="application/json" id="lightRemoteAiGuideSource">'+payload+'</script>'+anchor);
}
export function renderAiGuidePage(markdown,{origin='https://light-remote.thaiduy.digital',version='beta'}={}){
 const toc=[...markdown.matchAll(/^## ([^\n]+)/gm)].map(m=>({title:m[1],id:slugify(m[1])}));
 const html=[
  '<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta name="robots" content="index,follow"><meta name="theme-color" content="#0b0f13">',
  '<meta name="description" content="Light Remote official AI guide: Windows, macOS, Linux installation, ChatGPT A/B pairing, tools, billing, security and support.">',
  '<link rel="canonical" href="'+origin+'/ai-guide"><link rel="alternate" type="text/markdown" href="'+origin+'/ai-guide.md">',
  '<link rel="icon" href="/account/assets/light-remote.ico" sizes="any">',
  '<title>Light Remote AI Guide — Install, Pair, Use and Troubleshoot</title>',
  '<link rel="stylesheet" href="/account/assets/portal.css"><link rel="stylesheet" href="/account/assets/visual-system-v4.css"><script src="/account/assets/theme.js"></script></head>',
  '<body class="ai-guide-body"><header class="home-nav ai-guide-nav"><a class="home-brand" href="/"><img src="/account/assets/light-remote-mark.svg" alt="Light Remote logo"><span><strong>Light Remote</strong><small>Official AI Guide</small></span></a>',
  '<nav><a href="/">Home</a><a href="/downloads">Downloads</a><a href="/account">Account</a><a href="/support">Support</a></nav><div class="home-nav-actions"><a class="btn primary" href="/account/register">Start free</a></div></header>',
  '<main><section class="ai-guide-hero"><div class="section-kicker">OFFICIAL AI-READABLE DOCUMENTATION · '+escapeHtml(version)+'</div>',
  '<h1>One guide.<br><span>Every next step.</span></h1><p>Share this guide with ChatGPT and ask any Light Remote question, from the very first installation step to advanced device workflows. The AI can guide you step by step.</p>',
  '<div class="ai-guide-actions"><button class="btn primary" type="button" data-copy-ai="prompt">Copy complete guide for ChatGPT</button>',
  '<button class="btn" type="button" data-copy-ai="url">Copy link only</button>',
  '<a class="btn" href="/ai-guide.md">AI-readable Markdown →</a></div>',
  '<p id="aiGuideCopyStatus" role="status" aria-live="polite">Copy complete guide to include the instructions in your AI chat even when the AI cannot open websites.</p></section>',
  '<div class="ai-guide-layout"><aside class="ai-guide-toc"><div class="section-kicker">CONTENTS</div>',
  toc.map(h=>'<a href="#'+h.id+'">'+escapeHtml(h.title)+'</a>').join(''),
  '</aside><article class="ai-guide-article">'+renderGuideMarkdown(markdown)+'</article></div></main>',
  '<footer class="home-footer ai-guide-footer"><a class="home-powered" href="https://thaiduy.digital" target="_blank" rel="noopener"><span>Powered by</span><strong>thaiduy.digital</strong></a><nav><a href="/">Home</a><a href="/downloads">Downloads</a><a href="/support">Support</a><a href="/privacy">Privacy</a></nav></footer>',
  '<script src="/account/assets/ai-guide-actions.js?v=complete-guide-20261010" defer></script></body></html>'
 ].join('\n');
 return embedAiGuideSource(html,markdown);
}
export function renderLlmsIndex(origin='https://light-remote.thaiduy.digital'){
 return '# Light Remote — AI Documentation\n\n> Official managed remote computing. Device enrollment is different from local A/B authorization.\n\n- [Full Guide]('+origin+'/ai-guide.md): AI-readable installation, troubleshooting, tools, security and billing.\n- [Browser Guide]('+origin+'/ai-guide): Same content with share buttons.\n- [Downloads]('+origin+'/downloads): Current platform installers and versions.\n- [Support]('+origin+'/support): Contact support.\n- [Official ChatGPT Plugin](https://chatgpt.com/plugins/plugin_asdk_app_6aab6c4bd7d88191a4108d8f4c5e4b4e): Connect via Local Wall A/B approval.\n';
}
