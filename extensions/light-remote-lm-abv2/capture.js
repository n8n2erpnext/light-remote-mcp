/**
 * Light Remote LM: bounded, read-only DOM snapshot segment.
 * Run only from an explicit toolbar click. No background page monitoring.
 *
 * Each segment re-reads the currently loaded turns and SHA-256 checks the
 * entire transcript against the initial snapshot. If the DOM changes while
 * reading, the capture fails closed instead of mixing two page versions.
 *
 * No Browsentic code copied. The cursor/digest concept informed this design.
 */
async function lightRemoteLmCaptureSegment({offset = 0, expectedSha256 = null, maxBytes = 65536, onlySettled = false} = {}) {
  try {
    const url = new URL(location.href);
    const provider=({'chatgpt.com':'chatgpt','claude.ai':'claude'})[url.hostname];
    if(url.protocol!=='https:'||!provider)return {ok:false,error:'Open ChatGPT or Claude in a conversation tab.'};
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 65536)
      return {ok:false,error:'Invalid capture cursor.'};

    const chatgpt=provider==='chatgpt';
    const modernThread='[data-thread-find-target="conversation"],[data-chatgpt-conversation-selection-target="true"]';
    const conversation='main,[role="main"],#thread'+(chatgpt?','+modernThread:'');
    const legacyRole='[data-message-author-role]';
    const legacyTurn=':is(article,section)[data-turn]';
    const userUnit='[data-chatgpt-search-unit-key$=":user"]',assistantUnit='[data-chatgpt-search-unit-key$=":assistant"]';
    const userBubble='[data-user-message-bubble="true"]',assistantBody='[data-markdown-text-style="assistant-message"]';
    const claudeRole='[data-testid="user-message"],[data-testid="assistant-message"],[data-cds="AssistantMessage"]';
    const selector=chatgpt?[userUnit,assistantUnit,userBubble,assistantBody,legacyRole,legacyTurn].join(','):claudeRole+',[data-is-streaming]';
    const excluded='[hidden],[inert],[aria-hidden="true"],nav,aside,[role="navigation"],[role="dialog"],button,[role="button"],input,textarea,[contenteditable="true"],.sr-only,[data-markdown-text-tone="tertiary"],.thinking-container,[data-writing-block]'
      +(chatgpt?', [data-message-author-role]:not([data-message-author-role="user" i],[data-message-author-role="assistant" i]), [data-chatgpt-search-unit-key]:not('+userUnit+','+assistantUnit+')':'');
    const turns=[],accepted=new Set();
    const visible=el=>{
      for(let n=el;n;n=n.parentElement){
        if(n.hidden||n.hasAttribute?.('inert')||n.getAttribute?.('aria-hidden')==='true')return false;
        const style=getComputedStyle(n);if(style.display==='none'||style.contentVisibility==='hidden'||['hidden','collapse'].includes(style.visibility))return false;
      }
      return true;
    };
    if(onlySettled&&[...document.querySelectorAll('[data-is-streaming="true"],button[data-testid="stop-button"],button[data-testid="stop-streaming"]')].some(visible)){
      return {ok:false,error:'conversation_still_generating'};
    }

    function roleOf(node){
      if(!chatgpt)return node.getAttribute('data-testid')==='user-message'?'user':'assistant';
      const explicit=node.getAttribute('data-message-author-role')??node.getAttribute('data-turn');
      if(explicit!==null)return explicit.toLowerCase();
      return node.matches(userUnit+','+userBubble)?'user':'assistant';
    }
    function readText(node){
      if(!node.querySelector(excluded))return node.innerText||'';
      // Read the live DOM without copying controls, clipped status labels or hidden text.
      let text='';
      for(const child of node.childNodes){
        if(child.nodeType===3){text+=child.nodeValue;continue;}
        if(child.nodeType!==1||child.matches(excluded)||!visible(child))continue;
        if(child.tagName==='BR'){text+='\n';continue;}
        const part=readText(child);
        const display=getComputedStyle(child).display;
        text+=part&&/^(block|list-item|table|flex|grid|flow-root)/.test(display)?'\n'+part+'\n':part;
      }
      return text;
    }
    function contentOf(node,role){
      if(chatgpt&&node.matches(userBubble+','+assistantBody))return [node];
      const modern=node.matches(userUnit+','+assistantUnit);
      if(chatgpt&&node.matches(legacyTurn)&&!modern&&node.querySelector(legacyRole+','+userUnit+','+assistantUnit))return [];
      if(!chatgpt&&node.matches('[data-is-streaming]')&&!node.matches(claudeRole)&&node.querySelector(claudeRole))return [];
      const primary=chatgpt?(role==='user'?userBubble:assistantBody):'[data-perf-reply-text]';
      const preferred=[...node.querySelectorAll(primary)];
      const raw=preferred.length?preferred:[...node.querySelectorAll('.markdown,[class*="whitespace-pre-wrap"],[class*="font-claude-response"]')];
      const blocks=raw.filter(el=>!el.closest(excluded)&&visible(el)&&!raw.some(parent=>parent!==el&&parent.contains(el)));
      if(blocks.length)return blocks;
      if(raw.length||modern||node.matches(legacyTurn)||!chatgpt&&!node.matches(claudeRole))return [];
      return [node];
    }
    for(const node of document.querySelectorAll(selector)){
      if(!node.closest(conversation)||node.closest(excluded)||!visible(node))continue;
      if(chatgpt&&node.matches(userUnit+','+assistantUnit+','+userBubble+','+assistantBody)&&
        !node.closest(modernThread+',[data-turn-key],'+legacyRole+','+legacyTurn))continue;
      let owner=node.parentElement;
      while(owner&&!accepted.has(owner))owner=owner.parentElement;
      if(owner)continue;
      const role=roleOf(node);
      if(!['user','assistant'].includes(role))continue;
      const value=contentOf(node,role).map(readText).filter(text=>text.trim()).join('\n\n').replace(/^\n+|\n+$/g,'');
      if(!value.trim())continue;
      accepted.add(node);
      const bodyOnly=chatgpt&&node.matches(userBubble+','+assistantBody);
      const turnKey=bodyOnly?node.closest('[data-turn-key]'):null;
      const previous=turns.at(-1);
      if(turnKey&&previous?.turnKey===turnKey&&previous.role===role)previous.text+='\n\n'+value;
      else turns.push({role,text:value,turnKey});
      if(turns.at(-1).text.length>900000)return {ok:false,error:'One loaded message exceeds the capture size.'};
    }
    if(!turns.length)return {ok:false,error:'No supported loaded messages found. The page layout may have changed.'};

    // Preserve message boundaries, roles and order; never infer unseen turns.
    const transcript = turns.map((turn, index) =>
      '===== Turn ' + (index+1) + ' · ' + turn.role.toUpperCase() + ' =====\n' + turn.text
    ).join('\n\n') + '\n';
    const bytes = new TextEncoder().encode(transcript);
    if (bytes.byteLength > 2 * 1024 * 1024)
      return {ok:false,error:'Loaded DOM text exceeds the 2 MiB inspection safety limit.'};
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), b=>b.toString(16).padStart(2,'0')).join('');
    const sourceUrl = url.origin+url.pathname;
    if (expectedSha256 && expectedSha256 !== sha256)
      return {ok:false,stale:true,error:'Conversation changed during capture; no mixed snapshot was returned.'};
    if (offset > bytes.byteLength)
      return {ok:false,error:'Capture cursor is past the end of the transcript.'};

    let end = Math.min(offset + maxBytes, bytes.byteLength);
    // UTF-8 chunks must never break within a multibyte codepoint.
    if (end < bytes.byteLength)
      while (end > offset && (bytes[end] & 0xC0) === 0x80) end--;
    if (end === offset && end < bytes.byteLength)
      return {ok:false,error:'Unable to advance UTF-8 cursor.'};
    const chunk = new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,end));
    const conversationId = /\/(?:c|chat)\/([a-zA-Z0-9-]{8,100})(?:\/|$)/.exec(url.pathname)?.[1] || null;
    return {
      ok:true,provider,adapterVersion:5,sha256,chunk,offset,nextOffset:end < bytes.byteLength ? end:null,
      totalBytes:bytes.byteLength,turns:turns.length,sourceUrl,conversationId,
      complete:end===bytes.byteLength,coverage:'loaded_dom_only'
    };
  } catch (error) {
    return {ok:false,error:'Capture failed. No partial conversation was retained.'};
  }
}
