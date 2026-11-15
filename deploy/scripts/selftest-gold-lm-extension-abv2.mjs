import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../extensions/light-remote-lm-abv2/',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),'utf8');
const m=JSON.parse(read('manifest.json'));
assert.equal(m.manifest_version,3);assert.equal(m.version,'0.4.0');assert.deepEqual(m.host_permissions,[]);
assert.deepEqual(m.optional_host_permissions,['http://127.0.0.1/*','http://localhost/*','http://100.94.184.141/*']);
for(const permission of ['cookies','debugger','webRequest','tabs','<all_urls>'])assert.ok(!m.permissions.includes(permission));
assert.ok(m.permissions.includes('activeTab'));assert.ok(m.permissions.includes('alarms'));
assert.equal(m.background.service_worker,'background.js');
for(const file of ['shared.js','capture.js','wall.js','restore.js','popup.js'])assert.ok(read('popup.html').includes('src="'+file+'"'));
assert.ok(read('popup.css').includes('GoogleSans-Variable.ttf'));
for(const file of ['shared.js','capture.js','wall.js','restore.js','popup.js','background.js']){
 const s=read(file);assert.ok(!/captureVisibleTab|chrome\.debugger|chrome\.cookies|eval\(/.test(s));
 assert.ok(!/https?:\/\/[^\s'"]+\.js/.test(s),'no remote executable code');
}
assert.ok(!/fetch\(/.test(read('background.js')),'background must not POST capture content');
assert.ok(!/click\(|requestSubmit|dispatchEvent\(.*[Kk]ey/.test(read('restore.js')),'restore never sends');
console.log('MEMORY_EXTENSION_V04_SINGLE_CORE_OPTIONAL_WALL_PERMISSION_PACKAGE_GUARD_PASS');
