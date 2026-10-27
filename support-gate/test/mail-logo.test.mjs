import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const html=readFileSync(new URL('../mail-templates/support-multibrand-outgoing.html',import.meta.url),'utf8');
const svg=readFileSync(new URL('../assets/branding/light-remote-mark.svg',import.meta.url));
const png=readFileSync(new URL('../public/branding/light-remote-mark.png',import.meta.url));
const server=readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
const logo='https://support.thaiduy.digital/ai-support/branding/light-remote-mark.png';

test('rasterized email logo is a PNG derived from the provided official SVG',()=>{
 assert.equal(svg.subarray(0,4).toString(),'<svg');
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),160);
 assert.equal(png.readUInt32BE(20),160);
 assert.equal(createHash('sha256').update(svg).digest('hex'),'417f45d22d27c82ba7159b94e6e59bc93da64546a5027ed06aaeb54a9cee1d65');
});
test('brand conditional switches only Light Remote from LR letters to hosted PNG',()=>{
 assert.equal(html.split('{{ template "content" . }}').length-1,1);
 assert.equal(html.split(logo).length-1,1);
 assert.match(html, /\{\{if eq \.Inbox\.Name "LightBI Support"\}\}BI\{\{else\}\}<img/);
 assert.match(html,/alt="Light Remote"/);
 assert.match(html,/support@lightbi\.app/);
 assert.match(html,/support@thaiduy\.digital/);
});
test('PNG is served without cookie auth and has correct Content-Type',()=>{
 const asset=server.indexOf("'/branding/light-remote-mark.png'");
 const guard=server.indexOf("const s=await guard(req,res,method!=='GET')");
 assert.ok(asset>0 && guard>asset,'branded asset must be public for email clients');
 assert.match(server,/file\.endsWith\('\.png'\)\?'image\/png'/);
 assert.match(server,/type==='image\/png'\?'public, max-age=3600'/);
});
