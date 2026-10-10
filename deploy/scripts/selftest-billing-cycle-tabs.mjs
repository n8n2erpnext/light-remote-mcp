import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {LIGHT_REMOTE_PLAN_OFFERS} from '../../lib/light-remote-plan-offers.mjs';

const page=fs.readFileSync(new URL('../../plugin-server/account-portal/billing.html',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../../plugin-server/account-portal/portal.css',import.meta.url),'utf8');
const start=page.indexOf('const billingPeriods=Object.freeze(');
const end=page.indexOf('async function load(){',start);
assert(start>=0&&end>start,'billing cycle controller must be present');
assert.equal((page.match(/class="plan-card(?:\s|")/g)||[]).length,3,'one pricing area, 3 plan cards');
assert.match(page,/role="tablist"/);
assert.match(page,/role="tabpanel"/);
assert.match(page,/data-cycle="monthly"/);
assert.match(page,/data-cycle="yearly"/);
assert.match(page,/2 months free/);
assert.match(page,/if\(pricingCycle!=='monthly'\)/,'yearly must be blocked at checkout action');
assert.match(css,/billing-tabbed-plans\{grid-template-columns:repeat\(3/);
assert.match(css,/@media\(max-width:680px\).*?billing-tabbed-plans\{grid-template-columns:1fr\}/);
const byId=new Map();
function element(id){
 if(!byId.has(id)){
  const selected=new Set(),handlers={};
  byId.set(id,{id,textContent:'',disabled:false,tabIndex:0,
   classList:{toggle(name,on){if(on)selected.add(name);else selected.delete(name)},contains:name=>selected.has(name)},
   setAttribute(name,val){this[name]=val},addEventListener(type,fn){handlers[type]=fn},
   dispatch(type,value){handlers[type]?.(value??{})},focus(){this.focused=true}});
 }
 return byId.get(id);
}
const domIds=['freePriceValue','freePriceUnit','proPriceValue','proPriceUnit',
 'proTeamPriceValue','proTeamPriceUnit','proYearlySavings','proTeamYearlySavings',
 'billingMonthlyTab','billingYearlyTab','billingPlans','billingCycleExplanation',
 'billingCycleNotice','proPriceMeta','upgrade'];
const scope=Object.fromEntries(domIds.map(id=>[id,element(id)]));
scope.billingMonthlyTab.dataset={cycle:'monthly'};
scope.billingYearlyTab.dataset={cycle:'yearly'};
scope.me={account:{plan:'free'}};
scope.pricingCycle='monthly';
scope.paddlePriceError=null;
scope.paddlePricePreview=null;
scope.render=function(){scope.upgrade.disabled=false;scope.updateBillingCycleUI()};
scope.globalThis=scope;
vm.runInNewContext(page.slice(start,end)+'\n'+
 'globalThis.updateBillingCycleUI=updateBillingCycleUI;'+
 'globalThis.selectBillingCycle=selectBillingCycle;',scope);
assert.equal(scope.proPriceValue.textContent,'$20');
assert.equal(scope.proTeamPriceValue.textContent,'$55');
assert.equal(scope.freePriceValue.textContent,'$0');
assert.equal(scope.billingMonthlyTab['aria-selected'],'true');
scope.billingYearlyTab.dispatch('click');
assert.equal(scope.proPriceValue.textContent,'$200');
assert.equal(scope.proTeamPriceValue.textContent,'$550');
assert.equal(scope.freePriceUnit.textContent,'/ year');
assert.equal(scope.billingYearlyTab['aria-selected'],'true');
assert.equal(scope.billingMonthlyTab['aria-selected'],'false');
assert.equal(scope.upgrade.disabled,true,'yearly cannot accidentally buy monthly Pro');
assert.match(scope.proPriceMeta.textContent,/checkout is not enabled/i);
assert.match(scope.billingCycleNotice.textContent,/Annual Paddle checkout is not configured/);
scope.billingMonthlyTab.dispatch('click');
assert.equal(scope.proPriceValue.textContent,'$20');
assert.equal(scope.proTeamPriceValue.textContent,'$55');
assert.equal(scope.freePriceUnit.textContent,'/ month');
assert.equal(scope.upgrade.disabled,false);
scope.paddlePricePreview={total:'$21.35'};
scope.updateBillingCycleUI();
assert.equal(scope.proPriceValue.textContent,'$21.35','monthly verified Paddle preview wins');
scope.billingMonthlyTab.dispatch('keydown',{key:'ArrowRight',preventDefault(){}});
assert.equal(scope.proPriceValue.textContent,'$200','yearly never inherits monthly localized price');
assert.equal(scope.upgrade.disabled,true);
scope.billingYearlyTab.dispatch('keydown',{key:'Home',preventDefault(){}});
assert.equal(scope.proPriceValue.textContent,'$21.35');
assert.equal(LIGHT_REMOTE_PLAN_OFFERS.pro.annualPriceUSD,200);
assert.equal(LIGHT_REMOTE_PLAN_OFFERS.proTeam.annualPriceUSD,550);
console.log('billing_tabs_monthly_yearly_prices_and_units=PASS');
console.log('billing_tabs_keyboard_aria_and_responsive_layout=PASS');
console.log('billing_tabs_block_yearly_paddle_checkout=PASS');
console.log('billing_tabs_monthly_paddle_price_preview_isolated=PASS');
console.log('billing_tabs_plan_offers_match_catalog=PASS');
