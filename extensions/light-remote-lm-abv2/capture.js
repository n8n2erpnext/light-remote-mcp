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
async function lightRemoteLmCaptureSegment({offset = 0, expectedSha256 = null, maxBytes = 65536} = {}) {
  try {
    const url = new URL(location.href);
    const provider=({'chatgpt.com':'chatgpt','claude.ai':'claude'})[url.hostname];
    if(url.protocol!=='https:'||!provider)return {ok:false,error:'Open ChatGPT or Claude in a conversation tab.'};
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 65536)
      return {ok:false,error:'Invalid capture cursor.'};

    const turns = [];
    const selector=provider==='chatgpt'?'[data-message-author-role]':'[data-testid="user-message"],[data-testid="assistant-message"],[data-is-streaming]';
    const visible=el=>{
      for(let n=el;n;n=n.parentElement){
        if(n.hidden||n.hasAttribute?.('inert')||n.getAttribute?.('aria-hidden')==='true')return false;
        const style=getComputedStyle(n);if(style.display==='none'||['hidden','collapse'].includes(style.visibility))return false;
      }
      return true;
    };
    for(const node of document.querySelectorAll(selector)){
      if(node.parentElement?.closest(selector)||!node.closest('main')||!visible(node))continue;
      const role=provider==='chatgpt'?String(node.getAttribute('data-message-author-role')||'').toLowerCase():node.getAttribute('data-testid')==='user-message'?'user':'assistant';
      if(!['user','assistant'].includes(role))continue;
      const raw=[...node.querySelectorAll('.markdown,[class*="whitespace-pre-wrap"],[class*="font-claude-response"]')];
      const blocks=raw.filter(el=>visible(el)&&!raw.some(parent=>parent!==el&&parent.contains(el)));
      const value=(blocks.length?blocks:[node]).map(el=>el.innerText||'').filter(Boolean).join('\n\n').trim();
      if(!value)continue;
      if(value.length>900000)return {ok:false,error:'One loaded message exceeds the capture size.'};
      turns.push({role,text:value});
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
    const conversationId = /^\/(?:c|chat)\/([a-zA-Z0-9-]{8,100})/.exec(url.pathname)?.[1] || null;
    return {
      ok:true,provider,adapterVersion:4,sha256,chunk,offset,nextOffset:end < bytes.byteLength ? end:null,
      totalBytes:bytes.byteLength,turns:turns.length,sourceUrl,conversationId,
      complete:end===bytes.byteLength,coverage:'loaded_dom_only'
    };
  } catch (error) {
    return {ok:false,error:'Capture failed. No partial conversation was retained.'};
  }
}
