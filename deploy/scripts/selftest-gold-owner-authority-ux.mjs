import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../../plugin-server/admin-portal/index.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../../plugin-server/account-portal/portal.css',import.meta.url),'utf8');
assert.match(html,/id="ownerAuthorityEmail"/);
assert.match(html,/assets\/icons\/material\/security\.svg/);
assert.match(html,/id="ownerAuthorityRevision"/);
assert.match(html,/id="ownerTransferToggle"[^>]+aria-expanded="false"[^>]+disabled/);
assert.match(html,/id="ownerTransferEditor" class="owner-transfer-editor hide"/);
assert.match(html,/id="ownerTransferForm" class="owner-transfer-form"/);
assert.doesNotMatch(html,/id="ownerTransferForm" class="admin-form/);
assert.match(html,/owner-row-badge/);
assert.match(html,/portal\.css\?rev=owner-authority-ux-v2/);
assert.match(css,/#view-accounts \.owner-transfer-form\{/);
assert.match(css,/@media\(max-width:650px\)/);
assert.match(css,/#view-accounts \.owner-transfer-field-grid\{display:grid;grid-template-columns:repeat\(2/);
const start=html.indexOf('let ownerTransferCandidates=[],ownerTransferDeviceCount=0;');
const end=html.indexOf('function renderAccounts(){',start);
assert.ok(start>0&&end>start,'owner controller source');
const classList=(values=[])=>{
 const store=new Set(values);
 return {add(x){store.add(x)},remove(x){store.delete(x)},
  contains(x){return store.has(x)},toggle(x,on){if(on)store.add(x);else store.delete(x)}};
};
const element=(extra={})=>({textContent:'',value:'',innerHTML:'',disabled:false,
 classList:classList(),focus(){this.focused=true},setAttribute(k,v){this[k]=v},...extra});
let response={ok:true,ownerAccountId:'acct_new',ownerEmail:'new-owner@example.test',
 ownerEmailVerified:true,ownerRevision:1,previousOwnerDeviceCount:0,candidates:[]};
const values={};
for(const id of [
 'ownerTransferPanel','ownerTransferEditor','ownerTransferToggle','ownerTransferTarget',
 'ownerTransferPassword','ownerTransferConfirmation','ownerTransferDeviceAck',
 'ownerTransferMessage','ownerAuthorityEmail','ownerAuthorityVerified',
 'ownerAuthorityRevision','ownerAuthorityHistory','ownerAuthorityHint',
 'ownerTransferDetails','ownerTransferExpected','ownerTransferButton',
 'ownerTransferClose','ownerTransferForm'
])values[id]=element();
values.ownerTransferPanel.classList=classList(['hide']);
values.ownerTransferEditor.classList=classList(['hide']);
const context={...values,
 api:async()=>response,
 fmt:n=>new Intl.NumberFormat('en').format(Number(n)||0),
 esc:v=>String(v??'').replace(/[&<>"']/g,''),
 confirm:()=>false,
 location:{href:''},
 console,
};
vm.runInNewContext(html.slice(start,end),context,{timeout:3000});
await context.loadOwnerAuthority();
assert.equal(values.ownerTransferPanel.classList.contains('hide'),false);
assert.equal(values.ownerAuthorityEmail.textContent,'new-owner@example.test');
assert.equal(values.ownerAuthorityVerified.textContent,'Verified email · protected administrator');
assert.equal(values.ownerAuthorityRevision.textContent,'1');
assert.match(values.ownerAuthorityHistory.textContent,/1 completed ownership transfer/);
assert.equal(values.ownerTransferToggle.disabled,true,'no eligible accounts must disable handoff');
assert.equal(values.ownerTransferEditor.classList.contains('hide'),true,'already-transferred UI stays compact');
assert.match(values.ownerAuthorityHint.textContent,/No other verified accounts/);
console.log('GOLD_OWNER_UX_POST_HANDOFF_SUMMARY_NO_EMPTY_FORM=PASS');
response={...response,ownerRevision:2,previousOwnerDeviceCount:3,candidates:[
 {accountId:'acct_other',email:'verified-other@example.test',emailVerified:true,status:'active'}]};
await context.loadOwnerAuthority();
assert.equal(values.ownerTransferToggle.disabled,false);
values.ownerTransferToggle.onclick();
assert.equal(values.ownerTransferEditor.classList.contains('hide'),false);
assert.equal(values.ownerTransferToggle['aria-expanded'],'true');
values.ownerTransferTarget.value='acct_other';
values.ownerTransferTarget.onchange();
assert.match(values.ownerTransferExpected.textContent,/TRANSFER OWNER TO verified-other@example.test/);
assert.match(values.ownerTransferDetails.textContent,/3 device identities/);
values.ownerTransferPassword.value='secret-placeholder';
values.ownerTransferConfirmation.value='TRANSFER OWNER TO verified-other@example.test';
values.ownerTransferDeviceAck.checked=true;
values.ownerTransferClose.onclick();
assert.equal(values.ownerTransferEditor.classList.contains('hide'),true);
assert.equal(values.ownerTransferPassword.value,'');
assert.equal(values.ownerTransferConfirmation.value,'');
assert.equal(values.ownerTransferDeviceAck.checked,false);
console.log('GOLD_OWNER_UX_ELIGIBLE_TRANSFER_TWO_STEP_COLLAPSE_AND_RESET=PASS');
