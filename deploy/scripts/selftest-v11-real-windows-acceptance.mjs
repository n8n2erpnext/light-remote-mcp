import fs from 'node:fs';

const script=fs.readFileSync('client/windows-native/acceptance/real-remote-browser-os-input.ps1','utf8');
const fixture=fs.readFileSync('client/windows-native/acceptance/real-remote-browser-os-input.html','utf8');

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

for(const forbidden of ['Input.dispatch','Runtime.evaluate','Runtime.callFunctionOn','DOM.resolveNode']){
  need(!script.includes(forbidden),'windows_acceptance_cdp_mutation_forbidden:'+forbidden);
}

need(fixture.includes('aria-pressed="false"'),'windows_acceptance_fixture_initial_state_missing');
need(fixture.includes("setAttribute('aria-pressed','true')"),'windows_acceptance_fixture_pressed_change_missing');
need(fixture.includes("setAttribute('aria-label','Light Remote Accepted')"),'windows_acceptance_fixture_name_change_missing');
need(fixture.includes("addEventListener('click'"),'windows_acceptance_fixture_click_handler_missing');
need(!fixture.match(/https?:\/\//i),'windows_acceptance_fixture_must_be_offline');

console.log('v11-real-windows-os-input-contract=PASS');
console.log('v11-real-windows-cdp-observation-only=PASS');
console.log('v11-real-windows-state-change-fixture=PASS');
