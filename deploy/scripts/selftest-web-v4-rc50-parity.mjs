import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {renderAiGuidePage,renderLlmsIndex} from '../../plugin-server/ai-guide-page.mjs';

const root=new URL('../../plugin-server/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),'utf8');
const home=read('public-home.html'),v4=read('account-portal/visual-system-v4.css');
const guide=read('ai-guide.md'),server=read('server.mjs'),portal=read('account-portal.mjs');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
assert.equal(sha(home.replace(/<section class="home-ai-guide"[\s\S]*?<\/section>/,'').replace('ai-guide-actions.js?v=complete-guide-20261010','ai-guide-actions.js')),'379d57c96e59cdf6ee02011287ff67c3edbb832e42a7ebebbd65263bc2809e97','Production V4 sections except intentionally repaired AI Guide card must remain byte-identical');
assert.equal(sha(v4),'ace1051e15aea8961560dd5c9ccd20548698b8c4a6dfaf5263f153677c183501','V4 CSS must match production');
for(const section of ['See the 4 setup steps','home-ai-guide','home-hero-guidance','how-it-works','/account/assets/visual-system-v4.css',
 '/account/assets/ai-guide-actions.js','/ai-guide','AI Guide','Start free — connect a device']){
 assert(home.toLowerCase().includes(section.toLowerCase()),'Missing V4 section '+section);
}
assert(!home.includes('Open official ChatGPT plugin</a><a class="btn hero-btn" href="/account/register">Create free account'),'old rc50 CTA must not remain');
for(const route of ['/ai-guide','/ai-guide.md','/llms.txt','/llms-full.txt'])
 assert(server.includes("app.get('"+route+"'"),'missing public route '+route);
for(const route of ['/account/assets/visual-system-v4.css','/account/assets/ai-guide-actions.js'])
 assert(portal.includes("app.get('"+route+"'"),'missing asset route '+route);
assert(server.includes('installAnnouncements(app)'),'managed site announcement middleware must remain');
assert(server.includes('registerClientAnnouncementFeed(app)'),'client broadcast feed must remain');
assert(portal.includes("'paddle-offer-checkout'"),'rc50 billing must remain');
assert(portal.includes("'team-inbox'"),'rc50 Team inbox must remain');
const doc=renderAiGuidePage(guide,{origin:'https://rc50-mcp.thaiduy.digital',version:'rc.50'});
assert(doc.includes('/account/assets/visual-system-v4.css'));
assert(doc.includes('https://rc50-mcp.thaiduy.digital/ai-guide'));
assert(doc.includes('rc.50'));
const llms=renderLlmsIndex('https://rc50-mcp.thaiduy.digital');
assert(llms.includes('https://rc50-mcp.thaiduy.digital'));
console.log('web_v4_production_home_excluding_ai_copy_card_unchanged=PASS');
console.log('web_v4_css_exact_production_source=PASS');
console.log('web_v4_onboarding_ai_guide_and_llms_routes=PASS');
console.log('web_v4_rc50_announcements_team_billing_inbox_preserved=PASS');
