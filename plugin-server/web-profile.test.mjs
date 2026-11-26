import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { getWebProfile, renderWebProfile } from './web-profile.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const gold=getWebProfile({LR_GOLD_AB_V2_ACCOUNT_UI:'1'});

test('Gold Home and guides point to device-first A/B v2',()=>{
  const home=renderWebProfile(read('./public-home.html'),gold);
  assert.match(home,/data-pairing="agent-request"/);
  assert.match(home,/data-short-id>ABCD02/);
  assert.match(home,/data-b-code>[A-Z0-9]{4}-[A-Z0-9]{4}/);
  assert.match(home,/Account → Connection requests/);
  assert.doesNotMatch(home,/send A code|fresh A code|data-a-code|profile:/);
  const guide=renderWebProfile(read('./ai-guide.md'),gold);
  assert.match(guide,/## How A\/B v2 approval works/);
  assert.match(guide,/same request and waits for \*\*ready/);
  assert.doesNotMatch(guide,/fresh .*A code|need_a_code|Local Wall \/approve|profile:/);
  const legacy=renderWebProfile(read('./public-home.html'),getWebProfile({}));
  assert.match(legacy,/data-pairing="legacy"/);
  assert.match(legacy,/send A code/);
});

test('Family links follow the selected account profile without enabling the add-on',()=>{
  assert.equal(gold.shareEnabled,false);
  const files=['index','billing','inbox','settings','usage','sessions','pro-share'];
  for(const name of files){
    const html=renderWebProfile(read('./account-portal/'+name+'.html'),gold);
    assert.match(html,/\/account\/assets\/visual-system-v4.css/);
    assert.match(html,/href="\/account\/pro-share"/);
    assert.doesNotMatch(html,/__WEB_|profile:/);
    for(const [,script] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script);
  }
  const family=renderWebProfile(read('./account-portal/pro-share.html'),gold);
  assert.match(family,/data-share-enabled="false"/);
  assert.match(family,/id="shareControls" hidden/);
  assert.match(family,/\/account\/team\?legacy=1/);
  assert.match(family,/encodeURIComponent\('\/account\/pro-share'\)/);
  assert.match(read('./account-portal/team.html'),/encodeURIComponent\('\/account\/team\?legacy=1'\)/);
  const enabled=getWebProfile({
    LR_GOLD_PRO_SHARE_CORE:'1',LR_GOLD_PRO_SHARE_ACCOUNT_HTTP:'1',LR_GOLD_PRO_SHARE_PORTAL_UI:'1'
  });
  assert.equal(enabled.shareEnabled,true);
  assert.match(renderWebProfile(read('./account-portal/pro-share.html'),enabled),/data-share-enabled="true"/);
  const billing=renderWebProfile(read('./account-portal/billing.html'),gold);
  assert.match(billing,/id="proShareCard"/);
  assert.doesNotMatch(billing,/id="proTeamCard"|5 seats total/);
  assert.match(renderWebProfile(read('./account-portal/billing.html'),getWebProfile({})),/id="proTeamCard"/);
});
