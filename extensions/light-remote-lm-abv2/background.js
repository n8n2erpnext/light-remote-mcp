'use strict';
const GOLD_ABV2_WALL_URL = 'http://100.94.184.141:15591/long-memory';
const MAX_BYTES = 512 * 1024;
const PENDING_TTL_MS = 10 * 60 * 1000;
function allowedWall(url) {
  try {
    const value = new URL(url);
    return value.protocol === 'http:' && value.hostname === '100.94.184.141' &&
      value.port === '15591' && value.pathname === '/long-memory' &&
      !value.username && !value.password && !value.search && !value.hash;
  } catch { return false; }
}
function validSnapshot(s) {
  if (!s || s.ok !== true || s.source !== 'chatgpt-dom-user-initiated' ||
      typeof s.text !== 'string' || !Number.isInteger(s.turns) || s.turns < 1 ||
      !/^https:\/\/chatgpt\.com\/[^?#]*$/.test(s.url || '') ||
      !/^[0-9a-f]{64}$/.test(s.sha256 || '') || s.coverage !== 'loaded_dom_only')
    return false;
  return new TextEncoder().encode(s.text).byteLength <= MAX_BYTES;
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.type !== 'LRLM_PREPARE_WALL' || sender.id !== chrome.runtime.id)
    return false;
  (async () => {
    if (!validSnapshot(request.snapshot)) throw Error('Invalid or oversized capture.');
    const tab = await chrome.tabs.create({url:GOLD_ABV2_WALL_URL,active:true});
    await chrome.storage.session.set({pendingWall:{
      tabId:tab.id,expiresAt:Date.now()+PENDING_TTL_MS,
      snapshot:request.snapshot
    }});
    await chrome.alarms.create('abv2-pending-expiry',{delayInMinutes:10});
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
// MV3 service workers may sleep. Alarm guarantees expired plaintext is evicted.
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== 'abv2-pending-expiry') return;
  const {pendingWall} = await chrome.storage.session.get('pendingWall');
  if (pendingWall && Date.now() >= pendingWall.expiresAt)
    await chrome.storage.session.remove('pendingWall');
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
    if (result[0]?.result?.ok) {
      await chrome.storage.session.set({lastStaged:{
        url:pendingWall.snapshot.url,
        sha256:pendingWall.snapshot.sha256,
        preparedAt:Date.now()
      }});
      await chrome.storage.session.remove('pendingWall');
    }
  } catch { /* No data sent; user can try again from the popup. */ }
}
async function prepareWallPage(snapshot) {
  if (location.protocol !== 'http:' || location.hostname !== '100.94.184.141' ||
      location.port !== '15591' || location.pathname !== '/long-memory')
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
  const contextDetails = document.getElementById('goldMemoryContextDetails');
  if (contextDetails) contextDetails.open = true;
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
  message.textContent = 'GoldABV2 Lab: ' + snapshot.turns +
    ' loaded ChatGPT turns staged in this page, NOT saved. Open an existing authorized Work or create a new Work under the CURRENT GoldABV2 owner (do not select historical Gold scopes). ' +
    'Review/redact the text, explicitly enable full-context opt-in and click Save context. ' +
    'No scope or approval was selected automatically.';
  document.getElementById('lightRemoteLmImportBanner')?.remove();
  captureArea.prepend(message);
  // GoldABV2 hides the context panel until the Owner opens an authorized Work.
  const list=document.getElementById('goldMemoryWorkList');
  if (list) {
    const notice=document.createElement('p');
    notice.id='lightRemoteLmWorkNotice';
    notice.setAttribute('role','status');
    notice.style.cssText='border:1px solid #bd9340;padding:10px;border-radius:8px;color:#f7dfaa;font-size:13px';
    notice.textContent='GoldABV2 LM snapshot staged in this browser tab (not saved). Open an authorized Work or Add work, then review Saved context and manually click Save context.';
    document.getElementById('lightRemoteLmWorkNotice')?.remove();
    list.prepend(notice);
  }
  // Reveal only view state; NEVER auto-click Save or change a scope/opt-in.
  const area=document.getElementById('goldMemoryWorkDetail');
  if (area && !area.hidden) captureArea.scrollIntoView({behavior:'smooth',block:'center'});
  return {ok:true,prepared:true};
}
