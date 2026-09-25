import fs from 'node:fs';

const script=fs.readFileSync('client/windows-native/acceptance/real-remote-browser-os-input.ps1','utf8');
const fixture=fs.readFileSync('client/windows-native/acceptance/real-remote-browser-os-input.html','utf8');
const workflow=fs.readFileSync('.github/workflows/windows-native-client.yml','utf8');
const inputHelper=fs.readFileSync('client/windows-native/GptOperator.Client/RealRemoteInput.cs','utf8');

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
  'windows-real-remote-browser-os-input-acceptance=PASS',
  "$unicodeText='Tiếng Việt ✓'",
  "@{type='text';text=$unicodeText}",
  'windows-real-remote-unicode-text=PASS',
  'windows-real-remote-text-cdp-ack=PASS',
  'windows-real-remote-text-state-change=PASS',
  "@{type='key';key='A';modifiers=@('CTRL')}",
  "@{type='key';key='TAB';modifiers=@()}",
  "@{type='key';key='RIGHT';modifiers=@()}",
  "@{type='key';key='ENTER';modifiers=@()}",
  'windows-real-remote-ctrl-a=PASS',
  'windows-real-remote-tab=PASS',
  'windows-real-remote-right=PASS',
  'windows-real-remote-enter=PASS',
  'windows-real-remote-keyboard-navigation=PASS',
  "@{type='wheel';delta=-1200}",
  'windows-real-remote-wheel=PASS',
  'windows-real-remote-scroll-closed-loop=PASS'
])need(script.includes(token),'windows_acceptance_contract_missing:'+token);

need(!script.includes('[hashtable]$Args'),'windows_acceptance_powershell_args_shadow_forbidden');
need(!script.includes('return$r.result'),'windows_acceptance_powershell_return_spacing_forbidden');
need(script.includes('return $r.result'),'windows_acceptance_powershell_return_missing');
need(script.includes('$readyDeadline=[DateTime]::UtcNow.AddSeconds([Math]::Min($TimeoutSeconds,10))'),'windows_acceptance_readiness_wait_missing');
need(workflow.includes('$browserReadyDeadline = [DateTime]::UtcNow.AddSeconds(5)'),'windows_hidden_smoke_readiness_wait_missing');
for(const forbidden of ['Input.dispatch','Runtime.evaluate','Runtime.callFunctionOn','DOM.resolveNode']){
  need(!script.includes(forbidden),'windows_acceptance_cdp_mutation_forbidden:'+forbidden);
}

need(fixture.includes('aria-pressed="false"'),'windows_acceptance_fixture_initial_state_missing');
need(fixture.includes("setAttribute('aria-pressed','true')"),'windows_acceptance_fixture_pressed_change_missing');
need(fixture.includes("setAttribute('aria-label','Light Remote Accepted')"),'windows_acceptance_fixture_name_change_missing');
need(fixture.includes("addEventListener('click'"),'windows_acceptance_fixture_click_handler_missing');
need(fixture.includes('aria-label="Light Remote Text Input"'),'windows_acceptance_fixture_textbox_missing');
need(fixture.includes("const expectedText='Tiếng Việt ✓';"),'windows_acceptance_fixture_unicode_expected_missing');
need(fixture.includes("setAttribute('aria-label','Light Remote Text Accepted')"),'windows_acceptance_fixture_unicode_state_change_missing');
need(fixture.includes('aria-label="Light Remote Keyboard Target"'),'windows_acceptance_fixture_keyboard_target_missing');
need(fixture.includes("const ctrlAText='CTRL+A OK';")&&fixture.includes("setAttribute('aria-label','Light Remote CtrlA Accepted')"),'windows_acceptance_fixture_ctrl_a_state_missing');
need(fixture.includes("addEventListener('focus'")&&fixture.includes("setAttribute('aria-label','Light Remote Tab Accepted')"),'windows_acceptance_fixture_tab_state_missing');
need(fixture.includes("event.key==='ArrowRight'")&&fixture.includes("setAttribute('aria-label','Light Remote Right Accepted')"),'windows_acceptance_fixture_right_state_missing');
need(fixture.includes("setAttribute('aria-label','Light Remote Enter Accepted')"),'windows_acceptance_fixture_enter_state_missing');
need(fixture.includes('role="region" aria-label="Light Remote Scroll Region"'),'windows_acceptance_fixture_scroll_region_missing');
need(fixture.includes("addEventListener('scroll'")&&fixture.includes("scrollbox.scrollTop>0")&&fixture.includes("setAttribute('aria-label','Light Remote Scroll Accepted')"),'windows_acceptance_fixture_scroll_state_missing');
need(inputHelper.includes('KeyUnicode=0x0004')&&inputHelper.includes('Keyboard(0,(ushort)ch,KeyUnicode)'),'windows_acceptance_unicode_sendinput_contract_missing');
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
