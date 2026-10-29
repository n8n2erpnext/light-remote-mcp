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
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com')
      return {ok:false,error:'Only ChatGPT Web is supported.'};
    if (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 4096 || maxBytes > 65536)
      return {ok:false,error:'Invalid capture cursor.'};

    const turns = [];
    for (const node of document.querySelectorAll('[data-message-author-role]')) {
      if (node.parentElement?.closest('[data-message-author-role]')) continue;
      if (!node.closest('main')) continue;
      const role = String(node.getAttribute('data-message-author-role') || '').toLowerCase();
      if (role !== 'user' && role !== 'assistant') continue;
      const content = node.querySelector('.markdown') ||
        node.querySelector('[class*="whitespace-pre-wrap"]') || node;
      const style = getComputedStyle(content);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const value = (content.innerText || content.textContent || '').trim();
      if (!value) continue;
      if (value.length > 900000) return {ok:false,error:'One loaded turn exceeds the safe capture size.'};
      turns.push({role,text:value});
    }
    if (!turns.length) return {ok:false,error:'No loaded ChatGPT messages found.'};

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
      return {ok:false,stale:true,error:'ChatGPT changed during capture; no mixed snapshot was returned.'};
    if (offset > bytes.byteLength)
      return {ok:false,error:'Capture cursor is past the end of the transcript.'};

    let end = Math.min(offset + maxBytes, bytes.byteLength);
    // UTF-8 chunks must never break within a multibyte codepoint.
    if (end < bytes.byteLength)
      while (end > offset && (bytes[end] & 0xC0) === 0x80) end--;
    if (end === offset && end < bytes.byteLength)
      return {ok:false,error:'Unable to advance UTF-8 cursor.'};
    const chunk = new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,end));
    const conversationId = /^\/c\/([a-zA-Z0-9-]{8,100})/.exec(url.pathname)?.[1] || null;
    return {
      ok:true,sha256,chunk,offset,nextOffset:end < bytes.byteLength ? end:null,
      totalBytes:bytes.byteLength,turns:turns.length,sourceUrl,conversationId,
      complete:end===bytes.byteLength,coverage:'loaded_dom_only'
    };
  } catch (error) {
    return {ok:false,error:'Capture failed: '+String(error?.message || error).slice(0,160)};
  }
}
