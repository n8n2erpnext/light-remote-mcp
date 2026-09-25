import fs from 'node:fs';

const script=fs.readFileSync('client/windows-native/acceptance/real-remote-browser-os-input.ps1','utf8');
const fixture=fs.readFileSync('client/windows-native/acceptance/real-remote-browser-os-input.html','utf8');
const workflow=fs.readFileSync('.github/workflows/windows-native-client.yml','utf8');

function need(value,message){if(!value)throw new Error(message);}
for(const token of [
  '--real-remote-helper',
  "provider='browser-cdp'",
  "urlMatch='real-remote-browser-os-input.html'",
  "coordinateSpace -ne 'screen-dip-estimate'",
  "@{type='click';button='left';count=1}",
  'sentInputs',
  "observation -ne 'cdp-snapshot+journal'",
  'windows-real-remote-os-input=PASS',
  'windows-real-remote-cdp-ack=PASS',
  'windows-real-remote-browser-state-change=PASS',
  'windows-real-remote-browser-os-input-acceptance=PASS'
])need(script.includes(token),'windows_acceptance_contract_missing:'+token);

need(!script.includes('[hashtable]$Args'),'windows_acceptance_powershell_args_shadow_forbidden');
for(const forbidden of ['Input.dispatch','Runtime.evaluate','Runtime.callFunctionOn','DOM.resolveNode']){
  need(!script.includes(forbidden),'windows_acceptance_cdp_mutation_forbidden:'+forbidden);
}

need(fixture.includes('aria-pressed="false"'),'windows_acceptance_fixture_initial_state_missing');
need(fixture.includes("setAttribute('aria-pressed','true')"),'windows_acceptance_fixture_pressed_change_missing');
need(fixture.includes("setAttribute('aria-label','Light Remote Accepted')"),'windows_acceptance_fixture_name_change_missing');
need(fixture.includes("addEventListener('click'"),'windows_acceptance_fixture_click_handler_missing');
need(!fixture.match(/https?:\/\//i),'windows_acceptance_fixture_must_be_offline');

const step='- name: Real Windows OS input acceptance';
need(workflow.includes(step),'windows_acceptance_workflow_step_missing');
need(workflow.includes('real-remote-browser-os-input.ps1 -ClientExe $exe -TimeoutSeconds 30'),'windows_acceptance_workflow_invocation_missing');
const stepStart=workflow.indexOf(step),stepEnd=workflow.indexOf('\n      - name:',stepStart+step.length);
const stepBody=workflow.slice(stepStart,stepEnd<0?workflow.length:stepEnd);
need(!stepBody.includes('continue-on-error'),'windows_acceptance_workflow_must_be_hard_gate');

console.log('v11-real-windows-os-input-contract=PASS');
console.log('v11-real-windows-cdp-observation-only=PASS');
console.log('v11-real-windows-state-change-fixture=PASS');
console.log('v11-real-windows-workflow-hard-gate=PASS');
