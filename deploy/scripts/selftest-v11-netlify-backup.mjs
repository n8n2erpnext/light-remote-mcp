import fs from 'node:fs';

const root=new URL('../../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
const exists=file=>fs.existsSync(new URL(file,root));
function expect(value,message){if(!value)throw new Error(message);}

const lane=JSON.parse(read('.light-remote-lane.json'));
expect(lane.id==='backup-netlify'&&lane.canonicalBranch==='backup/netlify'&&lane.transport==='netlify','netlify_lane_identity_invalid');
expect(lane.inheritsFrom==='main'&&lane.developmentAuthority===false,'netlify_lane_authority_invalid');

for(const file of [
  'netlify.toml',
  'netlify/functions/operator.mts',
  'netlify/functions/_shared/operator-handler.cjs',
  'netlify/functions/_shared/operator-request.cjs',
  'netlify/functions/_shared/operator-crypto-netlify.cjs',
  'netlify/functions/_shared/operator-netlify.cjs',
  'netlify/functions/_shared/plus-tool-helper.cjs',
  'netlify/functions/_shared/plus-batch-policy.cjs'
]) expect(exists(file),`netlify_overlay_missing:${file}`);

const handler=read('netlify/functions/_shared/operator-handler.cjs');
const helper=read('netlify/functions/_shared/plus-tool-helper.cjs');
const batch=read('netlify/functions/_shared/plus-batch-policy.cjs');
const entry=read('netlify/functions/operator.mts');
const toml=read('netlify.toml');

expect(handler.includes('connectionHelperView')&&handler.includes('nextUrl'),'netlify_connection_helper_next_url_missing');
expect(handler.includes("inspectPlusExecPayload(payload,{transport:'direct'})"),'netlify_direct_exec_batch_guard_missing');
expect(helper.includes('Do not split because a command may run for minutes'),'netlify_batching_guidance_missing');
expect(batch.includes('directPayloadBytes:6000')&&batch.includes('maxExecScriptBytes:32*1024'),'netlify_batch_budget_missing');
expect(entry.includes('_shared/operator-handler.cjs'),'netlify_operator_entry_handler_missing');
expect(toml.includes('[build]')||toml.includes('functions'),'netlify_toml_functions_missing');

console.log('v11-netlify-backup-overlay=PASS');
