(() => {
  'use strict';
  try {
    const url = new URL(location.href);
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com')
      return {ok:false,error:'Only chatgpt.com conversations are supported.'};
    const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
    const turns = [];
    for (const node of nodes) {
      // Skip nested duplicates, if the UI later introduces nested role containers.
      if (node.parentElement?.closest('[data-message-author-role]')) continue;
      if (!node.closest('main')) continue;
      const role = String(node.getAttribute('data-message-author-role') || '').toLowerCase();
      if (role !== 'user' && role !== 'assistant') continue;
      const content = node.querySelector('.markdown') ||
        node.querySelector('[class*="whitespace-pre-wrap"]') || node;
      if (getComputedStyle(content).display === 'none' ||
          getComputedStyle(content).visibility === 'hidden') continue;
      let value = (content.innerText || content.textContent || '').trim();
      // Do not silently fabricate messages, include UI chrome, or summarize.
      if (!value) continue;
      if (value.length > 900000) return {ok:false,error:'A single visible message exceeds the capture limit.'};
      turns.push({role,text:value});
    }
    if (!turns.length) return {ok:false,error:'No loaded ChatGPT turns found. Open a conversation.'};
    const conversationId = /^\/c\/([a-zA-Z0-9-]{8,100})/.exec(url.pathname)?.[1] || null;
    const capturedAt = new Date().toISOString();
    const header = [
      'Light Remote LM — user-initiated browser snapshot',
      'Source URL: ' + url.origin + url.pathname,
      'Captured at: ' + capturedAt,
      'Source integrity: DOM-visible text only; not a ChatGPT export or hidden conversation.',
      'Only loaded messages are captured. Earlier turns may be absent unless loaded by scrolling.',
      'Conversation ID: ' + (conversationId || 'not available'),
      'Visible turns: ' + turns.length,
      ''
    ];
    const transcript = turns.map((item, index) =>
      '===== Turn ' + (index + 1) + ' · ' + item.role.toUpperCase() + ' =====\n' + item.text
    ).join('\n\n');
    const text = header.join('\n') + transcript + '\n';
    return {ok:true,text,turns:turns.length,url:url.origin+url.pathname,
      capturedAt,conversationId,source:'chatgpt-dom-user-initiated'};
  } catch (error) {
    return {ok:false,error:'Capture failed: ' + String(error?.message || error).slice(0,140)};
  }
})();
