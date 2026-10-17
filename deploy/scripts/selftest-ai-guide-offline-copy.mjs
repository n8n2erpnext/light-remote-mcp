import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {embedAiGuideSource,renderAiGuidePage} from '../../plugin-server/ai-guide-page.mjs';

const read=url=>fs.readFileSync(new URL(url,import.meta.url),'utf8');
const guide=read('../../plugin-server/ai-guide.md');
const home=read('../../plugin-server/public-home.html');
const source=read('../../plugin-server/account-portal/ai-guide-actions.js');
const server=read('../../plugin-server/server.mjs');
const tag='<script type="application/json" id="lightRemoteAiGuideSource">';
for(const html of [embedAiGuideSource(home,guide),renderAiGuidePage(guide,{origin:'https://rc50-mcp.thaiduy.digital'})]){
 const start=html.indexOf(tag);
 assert(start>=0,'complete guide must be embedded in HTML, not fetched on click');
 const json=html.slice(start+tag.length,html.indexOf('</script>',start));
 assert.equal(JSON.parse(json).markdown,guide);
 assert(!json.includes('</script>'),'unsafe script sentinel');
}
assert(home.includes('data-copy-ai="links">Copy AI Prompt + Markdown'));
assert(home.includes('data-guide-direct-link'));
assert(home.includes('data-copy-ai="prompt">Copy Full Guide (offline)'));
assert(home.includes('href="/ai-guide.md"'));
assert(source.includes("const linksPrompt=()=>["));
for(const route of ['/ai-guide','/ai-guide.md','/llms.txt','/llms-full.txt'])
 assert(server.includes('PUBLIC_INDEXABLE_PATHS=new Set([')&&server.includes("'"+route+"'"),
   'AI document must not get blanket noindex: '+route);
assert(!source.includes('fetch('),'copying guide cannot depend on browser fetching its URL');
let listener=null,value='',target={textContent:''},button={dataset:{copyAi:'prompt'},disabled:false,textContent:'Copy Complete Guide',closest:()=>({querySelector:()=>target})};
const htmlSource={textContent:JSON.stringify({markdown:guide})};
const context={
 location:{origin:'https://rc50-mcp.thaiduy.digital'},
 navigator:{clipboard:{writeText:async text=>{value=text}}},
 document:{getElementById:()=>htmlSource,addEventListener:(name,fn)=>{if(name==='click')listener=fn}},
 setTimeout:()=>{},
 console
};
vm.runInNewContext(source,context);
assert.equal(typeof listener,'function');
await listener({target:{closest:()=>button}});
assert(value.includes(guide));
assert(value.includes('Do not depend on opening the URL.'));
assert(target.textContent.includes('Web access is NOT required'));
button.dataset.copyAi='links';
await listener({target:{closest:()=>button}});
assert(value.includes('https://rc50-mcp.thaiduy.digital/ai-guide.md'));
assert(value.includes('https://rc50-mcp.thaiduy.digital/llms-full.txt'));
assert(value.includes('say so clearly'));
assert(value.includes('https://light-remote.thaiduy.digital/downloads'));
assert(!value.includes(guide),'short prompt must not include full guide');
assert(target.textContent.includes('AI prompt copied'));
button.dataset.copyAi='url';
await listener({target:{closest:()=>button}});
assert.equal(value,'https://rc50-mcp.thaiduy.digital/ai-guide.md');
assert(target.textContent.includes('Direct Markdown URL copied'));
console.log('ai_guide_complete_markdown_embedded_without_network=PASS');
console.log('ai_guide_clipboard_contains_full_guide_without_external_fetch=PASS');
console.log('ai_guide_prompt_contains_direct_markdown_txt_links=PASS');
console.log('ai_guide_public_crawler_paths_explicitly_allowlisted=PASS');