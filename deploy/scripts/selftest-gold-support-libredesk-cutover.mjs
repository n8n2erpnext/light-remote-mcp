import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {renderSupportPage} from '../../plugin-server/support-page.mjs';
const html=renderSupportPage({origin:'https://gold.light-remote.thaiduy.digital',version:'test-gold'});
const backend=readFileSync(new URL('../../plugin-server/support-backoffice.mjs',import.meta.url),'utf8');
const tag=html.lastIndexOf('<script>'),close=html.indexOf('</script>',tag);
assert.ok(tag>0&&close>tag);
new vm.Script(html.slice(tag+8,close));
for(const phrase of ['Light Remote Support Center','support@thaiduy.digital','Create / track ticket','EVERYONE · NO ACCOUNT','Submit ticket','Copy support request','14 days','Open / Snoozed / Resolved / Closed','supportCaseForm','Copy support template','name="email"'])
 assert.ok(html.includes(phrase),'missing '+phrase);
assert.ok(html.includes("fetch('/support/api'"),'direct native submission from Gold form');
assert.ok(html.includes('credentials:\'same-origin\''),'same-origin browser request');
assert.ok(!html.includes('Helpdesk case'),'no stale helpdesk ticket link');
assert.ok(!html.includes('Private case submission is available on PRO/VIP'),'no paid account gate');
assert.ok(!html.includes('Your email app should open'),'no mailto as primary action');
assert.ok(backend.includes('callGoldSupportIntake')&&backend.includes("LIGHT_REMOTE_GOLD_DEMO==='1'"),'Gold native Libredesk integration');
console.log('GOLD_DISTRIBUTION_DIRECT_LIBREDESK_INTAKE=PASS');
