import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {HELPER_GROUPS,toolHelperHint,toolHelperOverview,toolHelperGroup,toolHelperView}=require('../../lib/plus-tool-helper.js');
const root=new URL('../../',import.meta.url),text=file=>fs.readFileSync(new URL(file,root),'utf8');

const context={context:{deviceId:'dev1',sessionId:'s_1234567890123456',agentId:'a_1234567890123456',nodeId:'node1',platform:'win32',architecture:'x64',workspace:'C:/work'}};
const hint=toolHelperHint();
assert.equal(hint.action,'tool-helper');
assert.match(hint.instruction,/compact Tool Helper overview/i);
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
assert.ok(JSON.stringify(desktop).includes('intervalMs=12'));
assert.match(desktop.rule,/only for real computer use/i);
assert.throws(()=>toolHelperGroup(context,'unknown'),/invalid_tool_helper_group/);

const api=text('api/operator.js'),guide=text('api/guide.js');
assert.ok(api.includes("action==='tool-helper'")&&api.includes("req.query?.group")&&api.includes("toolHelperView(current,{group})"));
assert.ok(api.includes("'tool-helper','context'")&&api.includes("'search-cancel','scp','transfer-begin'"));
assert.ok(guide.includes('compact capability index')&&guide.includes('group=<workspace|files|shell|transfer|desktop>')&&guide.includes('never preload every group'));
console.log('v10-tool-helper-overview=PASS bytes='+Buffer.byteLength(overviewJson));
console.log('v10-tool-helper-on-demand-groups=PASS');
console.log('v10-plus-direct-light-scp=PASS');
