import assert from 'node:assert/strict';
import fs from 'node:fs';
import {usesPersonalAgentSlot as admits} from '../../operator-host/personal-agent-tool-admission.mjs';
const checked={
 fs:['read','edit','write','list'],
 scp:['upload-begin','upload-chunk','upload-commit','download-begin','download-chunk'],
 process:['start'],terminal:['start'],search:['start']
};
for(const [family,operations] of Object.entries(checked)){
 for(const op of operations){
  assert.equal(admits({enabled:true,family,op}),true,family+':'+op);
  assert.equal(admits({enabled:false,family,op}),false,'disabled:'+family+':'+op);
 }
}
const controls={
 process:['output','stop','list','input'],
 terminal:['output','stop','list','input','resize','signal'],
 search:['results','cancel'],
 scp:['status','cancel']
};
for(const [family,ops] of Object.entries(controls))
 for(const op of ops)assert.equal(admits({enabled:true,family,op}),false,'control:'+family+':'+op);
for(const op of ['input','run','act','attach','frame','observe'])
 assert.equal(admits({enabled:true,family:'desktop',op}),false,'desktop awaits M4:'+op);
const source=fs.readFileSync('operator-host/executor.mjs','utf8');
for(const [family,varName] of Object.entries({fs:'fsRequest',scp:'request',process:'request',terminal:'request',search:'request'})){
 assert.ok(source.includes("usesPersonalAgentSlot({enabled:Boolean(personalAgentScheduler),family:'"+family+"',op:String("+varName+".op||'')})"),family);
}
assert.match(source,/return schedulePersonalEffect\(job,dispatch\)/);
assert.match(source,/personalAgentScheduler\.enqueue\(/);
assert.match(source,/status:shouldQueue\?'queued':'running'/);
console.log('M3_FIVE_TOOL_FAMILIES_SHARE_POSTGRES_PERSONAL_SLOT=PASS');
console.log('M3_CANCEL_STATUS_OUTPUT_INPUT_CONTROL_LANE_UNBLOCKED=PASS');
console.log('M3_DESKTOP_POINTER_ACTIONS_REQUIRE_FUTURE_M4_LOCK=PASS');
