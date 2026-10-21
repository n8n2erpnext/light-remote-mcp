import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {helperGroup} from '../../plugin-server/tool-helper.mjs';

const group=helperGroup('files',{platform:'linux',deviceId:'gold-schema-fixture'});
const edit=group.tools.edit;
assert.equal(edit.name,'light_remote_edit_file');
assert.match(edit.input,/expectedSha256\?/);
assert.match(edit.use,/409/);
assert.match(edit.use,/retryable:false/);
const tools=readFileSync(new URL('../../plugin-server/tools.mjs',import.meta.url),'utf8');
assert.match(tools,/expectedSha256:z\.string\(\)\.regex\(\/\^\[a-fA-F0-9\]\{64\}\$\/\)\.optional\(\)/);
assert.match(tools,/expectedSha256:x\.expectedSha256/);
console.log('G5_MCP_HELPER_SCHEMA_EXPECTED_SHA256=PASS');
console.log('G5_SCOPED_409_CAS_CONTRACT=PASS');
