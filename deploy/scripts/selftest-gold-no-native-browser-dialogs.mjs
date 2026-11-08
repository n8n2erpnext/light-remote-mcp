import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fleetJobPage} from '../../device-agent/fleet-job-page.mjs';
import {localProcessPage} from '../../device-agent/local-process-page.mjs';
import {updateSettingsHtml} from '../../device-agent/update-settings-page.mjs';

const sourceFiles=[
  'device-agent/local-wall.mjs',
  'device-agent/fleet-job-page.mjs',
  'device-agent/local-process-page.mjs',
  'device-agent/update-settings-page.mjs',
];
for(const file of sourceFiles){
  const source=fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/(?<![\w.])(?:window\.)?(?:alert|confirm|prompt)\s*\(/,
    'Native browser dialog is forbidden in Gold Wall: '+file);
}
const pages=[
  ['Fleet',fleetJobPage({csrfToken:'fixture'})],
  ['Processes',localProcessPage('fixture')],
  ['Device Update',updateSettingsHtml({surface:'local',modulesAvailable:true,csrfToken:'fixture'})]
];
for(const [name,html] of pages){
  assert.match(html,/id="wallDialogBackdrop"/,name+' must include app-owned modal');
  assert.match(html,/window\.wallConfirm/,name+' must provide shared confirm helper');
  assert.doesNotMatch(html,/(?:window\.)?(?:alert|confirm|prompt)\s*\(/,
    name+' rendered HTML must not invoke a native dialog');
}
assert.match(fs.readFileSync(new URL('../../device-agent/local-wall.mjs',import.meta.url),'utf8'),
  /function wallPrompt\(/);
console.log('GOLD_WALL_NO_NATIVE_BROWSER_DIALOGS_FOUR_SURFACES_PASS');
