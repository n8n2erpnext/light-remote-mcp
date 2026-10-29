'use strict';
const captureButton = document.getElementById('capture');
const sendButton = document.getElementById('send');
const info = document.getElementById('info');
const status = document.getElementById('status');
let snapshot = null;
const encoder = new TextEncoder();
function setStatus(message) { status.textContent = message; }
function showSnapshot(value) {
  info.textContent = value.turns + ' visible messages · ' +
    (encoder.encode(value.text).byteLength / 1024).toFixed(1) + ' KiB\n' +
    value.url + '\n' +
    'Only messages currently present in the page are included.';
}
captureButton.onclick = async () => {
  captureButton.disabled = true;
  sendButton.disabled = true;
  snapshot = null;
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab || !/^https:\/\/chatgpt\.com\//.test(tab.url || ''))
      throw Error('Open a ChatGPT conversation tab first.');
    const result = await chrome.scripting.executeScript({target:{tabId:tab.id},files:['capture.js']});
    const captured = result && result[0] && result[0].result;
    if (!captured || !captured.ok) throw Error(captured?.error || 'Unable to read visible conversation.');
    if (captured.turns < 1) throw Error('No loaded conversation messages found. Open a conversation first.');
    if (encoder.encode(captured.text).byteLength > 512 * 1024)
      throw Error('Capture exceeds the 512 KiB Gold limit. Use a smaller selection or existing Wall file import.');
    snapshot = captured;
    showSnapshot(captured);
    sendButton.disabled = false;
    setStatus('Captured locally. Review what will be saved in the Wall.');
  } catch(error) {
    setStatus(error.message || 'Capture failed.');
  } finally { captureButton.disabled = false; }
};
sendButton.onclick = async () => {
  if (!snapshot) return;
  sendButton.disabled = true;
  try {
    const reply = await chrome.runtime.sendMessage({type:'LRLM_PREPARE_WALL',snapshot});
    if (!reply?.ok) throw Error(reply?.error || 'Could not open Local Wall.');
    setStatus('Wall opened. Choose the correct Memory Scope, enable opt-in, then confirm Save.');
  } catch(error) {
    setStatus(error.message || 'Local Wall unavailable.');
    sendButton.disabled = false;
  }
};
