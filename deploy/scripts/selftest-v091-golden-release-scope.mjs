import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const need=(v,m)=>{if(!v)throw new Error(m);};
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
function walk(dir){const out=[];for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','bin','obj'].includes(e.name))continue;const p=path.join(dir,e.name);if(e.isDirectory())out.push(...walk(p));else out.push(p);}return out;}

need(read('VERSION').trim()==='0.9.1-beta.2','wrong_release_version');
for(const forbiddenPath of ['netlify','netlify.toml'])need(!fs.existsSync(path.join(root,forbiddenPath)),'active_netlify_path_present:'+forbiddenPath);

const roots=['device-agent','operator-host','gateway','client','api','lib','.github/workflows'];
const forbidden=/(Real Remote|real-remote|desktop-live|desktop-observe|desktop-input|desktop-act|RealRemote|UIAutomation|native-desktop|x-light-netlify-bridge|nmcp\.dashboard\.thaiduy\.store)/i;
for(const rel of roots){
  const p=path.join(root,rel);if(!fs.existsSync(p))continue;
  const files=fs.statSync(p).isDirectory()?walk(p):[p];
  for(const file of files){let text;try{text=fs.readFileSync(file,'utf8');}catch{continue;}need(!forbidden.test(text),'forbidden_stable_marker:'+path.relative(root,file));}
}

const continuity=read('lib/plus-client-continuity.cjs'),api=read('api/operator.js');
need(continuity.includes("reason:'client_ref'")&&api.includes('lr1\\.'),'golden_lr1_continuity_missing');
need(api.includes('plus-client-continuity'),'vercel_continuity_import_missing');

const executor=read('operator-host/executor.mjs');
const channel=read('operator-host/executor-routes-device-channel.mjs');
const fleet=read('operator-host/fleet-router.mjs');
need(executor.includes('abandonedCommandReceiptFromDisk'),'late_result_disk_receipt_missing');
need(channel.includes('abandonedCommandReceiptFromDisk'),'late_result_channel_recovery_missing');
need(fleet.includes('node.inFlight.size>0'),'inflight_presence_fix_missing');

const core=JSON.parse(read('client/core-files.json'));
need(core.files.some(x=>x.source==='device-agent/result-delivery.mjs'),'result_delivery_not_packaged');

const wall=read('device-agent/local-wall.mjs');
for(const token of ['opbadge.op-neutral','function notify(','function confirmAction(',"url.pathname==='/api/session-close'","materialIcon('settings')","classList.add('spinning')"])need(wall.includes(token),'golden_wall_polish_missing:'+token);

const map=read('docs/releases/GOLDEN_SOURCE_MAP_2026-09-28.md');
for(const token of ['204e654700c818f8837449c7f4f1342a0ef0a594','33ff0b4e69b919d920f053c87843dc5fd03c4267','57e641167572e4de9b794f9c783cc491aea42698','17c9dea9bfc7db912fd301130ff53fc2b23dbd59ee727b62a6f2183ca5134596'])need(map.includes(token),'golden_source_map_missing:'+token);

need(fs.existsSync(path.join(root,'docs/operations/RETIRED_NETLIFY_2026-09-28.md')),'netlify_retirement_record_missing');

console.log('v091-golden-release-scope=PASS');
