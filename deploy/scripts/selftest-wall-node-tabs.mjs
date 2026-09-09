import { dashboardHtml } from '../../gateway/dashboard.mjs';

const html = dashboardHtml();
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('wall inline script not found');
const inline = match[1];

for (const token of [
  "function nodeKey(nodeId)",
  "function selectedNodeId()",
  "b.textContent='NODE '",
  "const nodeId=selectedNodeId()",
  "(j.nodeId||'arm')===nodeId",
  "deviceRows.find(d=>(d.nodeId||'arm')===nodeId)",
  "renderDevices();renderTabs();applyFilter();",
]) {
  if (!inline.includes(token)) throw new Error(`wall node-tab contract missing: ${token}`);
}
if (!inline.includes("selected.startsWith('NODE:')")) throw new Error('node selection discriminator missing');
console.log('wall-node-tabs=PASS');
console.log('wall-node-filter=PASS');
console.log('wall-device-refresh-rerender=PASS');
