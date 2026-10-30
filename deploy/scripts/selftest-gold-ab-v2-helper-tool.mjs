// Gold P2-I2g MCP helper schema/compatibility boundary fixture.
// Default OFF must not call Operator and must not silently choose Main.
import assert from 'node:assert/strict';
import fs from 'node:fs';
// Pure source guard: the VPS-ARM source worktree intentionally does not
// install Plugin Server's production zod dependencies. Do not use npm install
// or change the live app to run this test. Auth HMAC is executed separately.
const adapter=fs.readFileSync(new URL('../../plugin-server/operator-adapter.mjs',import.meta.url),'utf8');
const source=fs.readFileSync(new URL('../../plugin-server/tools.mjs',import.meta.url),'utf8');
assert.match(adapter,/signGoldAbV2HelperTarget\(\{identity:this.identity,targetQuery,/);
assert.match(adapter,/callOperatorJson\('POST','\/v1\/plugin\/abv2\/target-resolve',proof\)/);
assert.match(source,/targetQuery:z\.string\(\)\.min\(1\)\.max\(120\)\.optional\(\)/);
assert.match(source,/aCode:z\.string\(\)\.regex/,'V1 aCode must remain');
assert.match(source,/continuation:z\.string\(\)\.min\(20\)\.max\(8192\)\.optional\(\)/);
assert.match(source,/abv2_helper_target_query_conflict/);
assert.match(source,/startAbV2:z\.boolean\(\)\.optional\(\)/);
assert.match(source,/requestKey:z\.string\(\)\.regex/);
assert.match(source,/if\(x.targetQuery\)return x.startAbV2\?/);
assert.match(source,/a.issueAbV2Request\(x.targetQuery,\{requestKey:x.requestKey\|\|null\}\)/);
assert.match(adapter,/async issueAbV2Request\(targetQuery,\{requestKey=null\}=\{\}\)/);
assert.match(adapter,/LR_GOLD_AB_V2_HELPER_REQUEST_ISSUE!=='1'/);
assert.match(adapter,/if\(process.env.LR_GOLD_AB_V2_HELPER_TARGET_QUERY!=='1'\)/);
assert.match(adapter,/status:'target_resolution_unavailable'/);
assert.match(adapter,/helperReady:false,approvalState:'not_issued'/);
assert.ok(!source.includes('if(x.targetQuery)return a.pairBegin'),
 'a name search must not reuse V1 A-code issuance');
console.log('GOLD_ABV2_MCP_HELPER_TARGET_QUERY_OPTIONAL_V1_UNCHANGED_OFF_FAILCLOSED=PASS');
