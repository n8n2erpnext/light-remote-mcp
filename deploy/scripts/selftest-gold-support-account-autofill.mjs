import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderSupportPage} from '../../plugin-server/support-page.mjs';
import {goldSupportIdentityFields} from '../../plugin-server/support-backoffice.mjs';
import {validateTicketPayload,nativeTicketBody} from '../../support-gate/src/gold-intake.mjs';

const html=renderSupportPage({origin:'https://gold.light-remote.thaiduy.digital',version:'test'});
const start=html.lastIndexOf('<script>'),end=html.indexOf('</script>',start);
new vm.Script(html.slice(start+8,end));
for(const item of ['supportAccountSummary','guestEmailGroup','supportEmailInput','supportSystemSummary',
    'supportSystemDetails','supportLinkedDevice',"/support/api?action=eligibility",
    "/account/api?action=devices","/healthz","registeredDevices.length===1"])
 assert.ok(html.includes(item),'missing '+item);
assert.match(html,/guestEmailGroup.hidden=Boolean\(verifiedAccount\)/);
assert.match(html,/supportEmailInput.required=!verifiedAccount/);

const fake={email:'attacker@example.invalid',accountPlan:'VIP',accountVerified:true,
 subject:'test',description:'Help',problemArea:'other',deviceStatus:'unknown'};
const guest=goldSupportIdentityFields(fake,{signedIn:false});
assert.equal(guest.email,'attacker@example.invalid');
assert.equal(guest.accountVerified,false);
assert.equal(guest.accountPlan,'');
const signed=goldSupportIdentityFields(fake,{signedIn:true,account:{email:'Member@Example.com',plan:'pro',accountId:'owner'}});
assert.equal(signed.email,'member@example.com');
assert.equal(signed.accountVerified,true);
assert.equal(signed.accountPlan,'PRO');
const norm=validateTicketPayload(JSON.stringify({...signed,browserPlatform:'Windows x64',
 browserUserAgent:'Browser safe',serverCoreVersion:'rc.48',mcpSurfaceVersion:'Gold',
 registeredDevice:{name:'Remote Laptop',platform:'windows',architecture:'amd64',version:'rc.48',status:'online'}}));
const body=nativeTicketBody(norm);
for(const word of ['Verified session','Current plan:','PRO','Gold Core:','Registered device:','Remote Laptop','Windows x64'])assert.ok(body.includes(word),'missing '+word);
assert.ok(!body.includes('attacker@example.invalid'));
console.log('GOLD_SUPPORT_ACCOUNT_EMAIL_PLAN_BROWSER_DEVICE_AUTOFILL=PASS');
