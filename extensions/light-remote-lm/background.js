'use strict';
const LOCAL_WALL_URL = 'http://127.0.0.1:5491/long-memory';
const MAX_BYTES = 512 * 1024;
const PENDING_TTL_MS = 10 * 60 * 1000;
function allowedWall(url) {
  try {
    const value = new URL(url);
    return value.protocol === 'http:' && value.port === '5491' &&
      (value.hostname === '127.0.0.1' || value.hostname === 'localhost') &&
      value.pathname === '/long-memory';
  } catch { return false; }
}
function validSnapshot(s) {
  if (!s || s.ok !== true || s.source !== 'chatgpt-dom-user-initiated' ||
      typeof s.text !== 'string' || !Number.isInteger(s.turns) || s.turns < 1 ||
      !/^https:\/\/chatgpt\.com\/(?:c\/[a-zA-Z0-9-]+)?/.test(s.url || ''))
    return false;
  return new TextEncoder().encode(s.text).byteLength <= MAX_BYTES;
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type !== 'LRLM_PREPARE_WALL' || sender.id !== chrome.runtime.id)
    return false;
  (async () => {
    if (!validSnapshot(request.snapshot)) throw Error('Invalid or oversized capture.');
    const tab = await chrome.tabs.create({url:LOCAL_WALL_URL,active:true});
    await chrome.storage.session.set({pendingWall:{
      tabId:tab.id,expiresAt:Date.now()+PENDING_TTL_MS,
      snapshot:request.snapshot
    }});
    sendResponse({ok:true});
    // Cover fast page loads that may precede the service-worker's next event.
    void maybePrepare(tab.id);
  })().catch(error => sendResponse({ok:false,error:String(error.message||error)}));
  return true;
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === 'complete' || change.url) void maybePrepare(tabId,tab.url);
});
chrome.tabs.onRemoved.addListener(async tabId => {
  const {pendingWall} = await chrome.storage.session.get('pendingWall');
  if (pendingWall?.tabId === tabId) await chrome.storage.session.remove('pendingWall');
});
async function maybePrepare(tabId, providedUrl) {
  const {pendingWall} = await chrome.storage.session.get('pendingWall');
  if (!pendingWall || pendingWall.tabId !== tabId) return;
  if (Date.now() > pendingWall.expiresAt) {
    await chrome.storage.session.remove('pendingWall');
    return;
  }
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const target = providedUrl || tab.url || '';
  // Login redirects are handled by the owner in the Wall itself.
  if (!allowedWall(target)) return;
  try {
    const result = await chrome.scripting.executeScript({
      target:{tabId},world:'ISOLATED',func:prepareWallPage,args:[pendingWall.snapshot]
    });
    if (result[0]?.result?.ok)
      await chrome.storage.session.remove('pendingWall');
  } catch { /* No data sent; user can try again from the popup. */ }
}
async function prepareWallPage(snapshot) {
  if (location.protocol !== 'http:' ||
      !['127.0.0.1','localhost'].includes(location.hostname) ||
      location.port !== '5491' || location.pathname !== '/long-memory')
    return {ok:false,reason:'wrong_wall'};
  let textarea, title, scope, panel;
  for (let attempt = 0; attempt < 60; attempt++) {
    textarea = document.getElementById('goldContextText');
    title = document.getElementById('goldContextTitle');
    scope = document.getElementById('goldReaderScope');
    panel = document.getElementById('goldModulesPanel');
    if (textarea && title && scope && panel) break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if (!textarea || !title || !scope || !panel)
    return {ok:false,reason:'wall_long_memory_not_ready'};
  panel.open = true;
  const captureArea = document.getElementById('goldContextCapture');
  if (!captureArea) return {ok:false,reason:'wall_context_import_missing'};
  textarea.value = snapshot.text;
  textarea.dispatchEvent(new Event('input',{bubbles:true}));
  title.value = 'ChatGPT · ' + new Date(snapshot.capturedAt).toLocaleString().slice(0,114);
  title.dispatchEvent(new Event('input',{bubbles:true}));
  // Deliberately neither select a scope nor grant opt-in or click Save.
  // Both decisions must be made by the Wall owner in its authenticated UI.
  const message = document.createElement('div');
  message.id = 'lightRemoteLmImportBanner';
  message.setAttribute('role','status');
  message.style.cssText =
    'background:#21382d;border:1px solid #74b58a;border-radius:9px;' +
    'padding:12px;margin-bottom:12px;color:#e5fff0;font-size:13px;line-height:1.5';
  message.textContent = 'Light Remote LM captured ' + snapshot.turns +
    ' visible turns. Review the text, select the correct Memory Scope, ' +
    'enable full-context opt-in for that scope, then click Save complete context and confirm.';
  document.getElementById('lightRemoteLmImportBanner')?.remove();
  captureArea.prepend(message);
  captureArea.scrollIntoView({behavior:'smooth',block:'center'});
  return {ok:true,prepared:true};
}
