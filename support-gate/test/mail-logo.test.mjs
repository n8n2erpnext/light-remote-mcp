import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const src=file=>readFileSync(new URL(file,import.meta.url));
const html=src('../mail-templates/support-multibrand-outgoing.html').toString();
const server=src('../src/server.mjs').toString();
const lr=src('../public/branding/light-remote-mark-256.png');
const bi=src('../public/branding/lightbi-app-icon.png');
const lrUrl='https://support.thaiduy.digital/ai-support/branding/light-remote-mark-256.png';
const biUrl='https://support.thaiduy.digital/ai-support/branding/lightbi-app-icon.png';
const digest=x=>createHash('sha256').update(x).digest('hex');

test('Light Remote image is byte-for-byte official GitHub 256px PNG, no recolor or re-export',()=>{
 assert.equal(lr.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(lr.readUInt32BE(16),256);
 assert.equal(lr.readUInt32BE(20),256);
 assert.equal(digest(lr),'cb89c23c30bbce1cca4ffd4bf307c4a9790d05180124bac6e434319816b39bd1');
});
test('LightBI image is byte-for-byte original GitHub app icon, not a generated BI text square',()=>{
 assert.equal(bi.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(bi.readUInt32BE(16),256);
 assert.equal(bi.readUInt32BE(20),256);
 assert.equal(digest(bi),'f7dd67137d483a9fadb817da6409ed11e052ba177cfafac99fa7593ab55749fc');
});
test('email default template switches only original logos based on inbox, with NO artificial backgrounds',()=>{
 assert.equal(html.split('{{ template "content" . }}').length-1,1);
 assert.equal(html.split(lrUrl).length-1,1);
 assert.equal(html.split(biUrl).length-1,1);
 assert.match(html,/\{\{if eq \.Inbox\.Name "LightBI Support"\}\}<img src="https:\/\/support\.thaiduy\.digital\/ai-support\/branding\/lightbi-app-icon\.png"/);
 assert.match(html,/alt="LightBI"/);
 assert.match(html,/alt="Light Remote"/);
 assert.match(html,/width="48" height="48"/);
 assert.doesNotMatch(html,/background:#f0c55b/);
 assert.doesNotMatch(html,/border-radius:10px;background/);
 assert.match(html,/support@lightbi\.app/);
 assert.match(html,/support@thaiduy\.digital/);
});
test('both originals are publicly served with correct MIME before owner auth',()=>{
 const guard=server.indexOf("const s=await guard(req,res,method!=='GET')");
 for(const name of ["'/branding/light-remote-mark-256.png'","'/branding/lightbi-app-icon.png'"]){
  const at=server.indexOf(name);
  assert.ok(at>0&&at<guard,name);
 }
 assert.match(server,/file\.endsWith\('\.png'\)\?'image\/png'/);
});
