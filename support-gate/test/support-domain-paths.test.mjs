import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
test('same-origin HTTPS domain assets and API remain prefixed',()=>{
 assert.match(html,/href="\/ai-support\/styles\.css"/);
 assert.match(html,/src="\/ai-support\/app\.js"/);
 assert.match(js,/fetch\('\/ai-support'\+path/);
 assert.match(html,/https:\/\/support\.thaiduy\.digital\//);
 assert.doesNotMatch(html,/100\.94\.184\.141:9087/);
});
test('legacy 9088 browser entrypoint redirects to canonical domain',()=>{
 assert.match(server,/location:'https:\/\/support\.thaiduy\.digital\/ai-support\/'/);
});
test('no extra login or native send confirm is reintroduced',()=>{
 assert.doesNotMatch(html,/id="password"|id="loginForm"/);
 assert.doesNotMatch(js,/window\.confirm\(|window\.prompt\(/);
 assert.match(html,/id="sendConfirm"/);
});
