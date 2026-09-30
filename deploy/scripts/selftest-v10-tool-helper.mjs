import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HELPER_GROUPS,toolHelperHint,toolHelperOverview,toolHelperGroup,toolHelperFull,toolHelperView}=require('../../lib/plus-tool-helper.js');
const root=new URL('../../',import.meta.url),text=file=>fs.readFileSync(new URL(file,root),'utf8');

const context={context:{deviceId:'dev1',sessionId:'s_1234567890123456',agentId:'a_1234567890123456',nodeId:'node1',platform:'win32',architecture:'x64',workspace:'C:/work'}};
const hint=toolHelperHint();
assert.equal(hint.action,'tool-helper');
assert.match(hint.instruction,/complete current tool contract/i);
assert.match(hint.instruction,/group=<workspace\|files\|shell\|transfer\|desktop>/);

const overview=toolHelperOverview(context);
assert.equal(overview.kind,'light-remote-tool-helper-overview');
assert.equal(overview.helperMode,'index-only');
assert.equal(overview.target.deviceId,'dev1');
assert.deepEqual(Object.keys(overview.groups),['workspace','files','shell','transfer','desktop']);
assert.deepEqual(Object.keys(HELPER_GROUPS),['workspace','files','shell','transfer','desktop']);
for(const [id,row] of Object.entries(overview.groups)){
  assert.ok(Array.isArray(row.actions)&&row.actions.length>0,'overview actions missing:'+id);
  assert.match(row.detail,new RegExp('group='+id));
}
const overviewJson=JSON.stringify(overview);
assert.ok(Buffer.byteLength(overviewJson)<4500,'overview helper token budget regressed');
for(const forbidden of ['semanticSessionId','browser-cdp','upload-chunk','durationMs?:0..1000','InvokePattern'])assert.ok(!overviewJson.includes(forbidden),'overview leaked detailed schema:'+forbidden);
const full=toolHelperView(context);
assert.equal(full.kind,'light-remote-tool-helper');assert.equal(full.helperMode,'full');
assert.deepEqual(full.optionalGroups,['workspace','files','shell','transfer','desktop']);
for(const tool of ['context','devices','session','fs','search','exec','process','terminal','durable','scp','bridgeTransfer','desktop','desktopInput'])assert.ok(full.tools[tool],'full helper missing:'+tool);
assert.equal(full.platformGuide.defaultShell,'powershell');assert.ok(JSON.stringify(full).includes('semanticSessionId')&&JSON.stringify(full).includes('upload-chunk'));
assert.deepEqual(toolHelperFull(context).tools,full.tools);

const files=toolHelperGroup(context,'files');
assert.equal(files.kind,'light-remote-tool-helper-group');
assert.equal(files.group,'files');
assert.ok(files.tools.fs&&files.tools.search);
assert.match(files.tools.fs.rule,/Prefer fs over shelling out/);

const shell=toolHelperView(context,{group:'shell'});
assert.equal(shell.group,'shell');
assert.ok(shell.tools.exec&&shell.tools.process&&shell.tools.terminal&&shell.tools.durable);
assert.equal(shell.platformGuide.defaultShell,'powershell');

const transfer=toolHelperGroup(context,'transfer');
assert.ok(transfer.tools.scp&&transfer.tools.bridgeTransfer);
for(const op of ['upload-begin','upload-chunk','upload-commit','download-begin','download-chunk','status','cancel'])assert.ok(JSON.stringify(transfer.tools.scp.ops).includes(op),'missing_scp_op:'+op);
assert.match(transfer.tools.scp.rule,/Never tunnel file bytes through exec stdout/);

const desktop=toolHelperGroup(context,'desktop');
assert.equal(desktop.group,'desktop');
assert.ok(desktop.tools.desktop&&desktop.tools.desktopInput);
assert.ok(JSON.stringify(desktop).includes('semanticSessionId'));
assert.ok(JSON.stringify(desktop).includes('browser-cdp'));
const desktopJson=JSON.stringify(desktop);
assert.ok(desktopJson.includes('intervalMs defaults 12'));
assert.ok(desktopJson.includes('F1-F12')&&desktopJson.includes('ENTER')&&desktopJson.includes('TAB')&&desktopJson.includes('ESC'));
assert.ok(desktopJson.includes('CTRL')&&desktopJson.includes('ALT')&&desktopJson.includes('SHIFT')&&desktopJson.includes('WIN'));
assert.ok(desktopJson.includes('1..4096 UTF-16 code units')&&desktopJson.includes('Unicode Windows SendInput per character'));
assert.ok(desktopJson.includes('±120 per normal notch')&&desktopJson.includes('durationMs'));
assert.ok(desktop.tools.desktopInput.inputRecipes?.multiline&&desktop.tools.desktopInput.inputRecipes?.selectAllReplace);
assert.ok(HELPER_GROUPS.desktop.actions.includes('desktop-run'));
assert.ok(desktop.tools.desktopInput.actions.includes('desktop-run'));
assert.equal(desktop.tools.desktopInput.run?.action,'desktop-run');
assert.ok(desktopJson.includes('foregroundTitleContains')&&desktopJson.includes('focusedNameContains'));
assert.match(desktop.rule,/only for real computer use/i);
assert.throws(()=>toolHelperGroup(context,'unknown'),/invalid_tool_helper_group/);

const api=text('api/operator.js'),guide=text('api/guide.js');
assert.ok(api.includes("'input','run','observe'")&&api.includes("if(op==='run')")&&api.includes('desktop.await=wait'));
assert.ok(api.includes("action==='tool-helper'")&&api.includes("req.query?.group")&&api.includes("toolHelperView(current,{group})"));
assert.ok(api.includes("'tool-helper','context'")&&api.includes("'search-cancel','scp','transfer-begin'"));
assert.ok(guide.includes('complete current tool contract')&&guide.includes('group=<workspace|files|shell|transfer|desktop>')&&guide.includes('optional'));
console.log('v10-tool-helper-overview=PASS bytes='+Buffer.byteLength(overviewJson));
console.log('v10-tool-helper-full-default=PASS');
console.log('v10-tool-helper-optional-groups=PASS');
console.log('v10-plus-direct-light-scp=PASS');
