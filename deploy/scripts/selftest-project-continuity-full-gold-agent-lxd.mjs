/* Read-only real Gold Operator Agent smoke, dedicated isolated LXD only.
 * Never enrolls, mutates permissions, creates tasks or prints credentials.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const url='http://127.0.0.1:5587';
assert.equal(fs.existsSync('/opt/light-remote-gold-continuity-candidate/device-agent/operator-agent.mjs'),true);
const coreRoot='/opt/light-remote-gold-continuity-candidate';
const core=JSON.parse(fs.readFileSync(coreRoot+'/client-core.json','utf8'));
assert.equal(core.files.length,101);
const inventory=core.files.map(item=>{
 const data=fs.readFileSync(coreRoot+'/'+item.path);
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),item.sha256,
   'UAT package diverges from verified Gold source: '+item.path);
 return item.path+'\0'+item.sha256+'\0'+item.size+'\n';
}).join('');
assert.equal(crypto.createHash('sha256').update(inventory).digest('hex'),core.digest);
console.log('REAL_GOLD_LXD_101_FILE_ON_DEVICE_SHA256_INTEGRITY_PASS');

const password=fs.readFileSync('/root/light-remote-continuity-uat-fixture.secret','utf8').trim();
const get=(pathname,cookie)=>fetch(url+pathname,{headers:cookie?{cookie}:{},redirect:'manual'});
const anon=await get('/api/project-continuity/getGlobalModules');
assert.equal(anon.status,401);
const login=await get('/login');
assert.equal(login.status,200);
const csrf=(await login.text()).match(/name="csrf" value="([^"]+)"/)?.[1];
assert.ok(csrf);
const form=new URLSearchParams({csrf,username:'uat-owner',password}).toString();
const reply=await fetch(url+'/auth/login',{
 method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
 body:form,redirect:'manual'
});
assert.equal(reply.status,303,'Real Gold Wall login must accept authenticated fixture owner');
const cookie=reply.headers.get('set-cookie')?.split(';')[0];
assert.match(cookie,/^lr_wall_session=/);
const home=await get('/',cookie);
assert.equal(home.status,200);
const wall=await home.text();
assert.match(wall,/<title>Light Remote MCP — Device Wall<\/title>/);
for(const name of ['Permissions','Projects','Link device','Settings']){
 assert.match(wall,new RegExp(name));
}
assert.ok(wall.includes('light-remote')&&wall.includes('href="/projects"'));
console.log('FULL_GOLD_AGENT_CANONICAL_BRAND_WALL_NAV_PASS');
const permission=await get('/permissions',cookie);
assert.equal(permission.status,200);
const permHtml=await permission.text();
assert.match(permHtml,/Agent permissions/);
assert.match(permHtml,/Filesystem access locations/);
const policy=await get('/api/policy-status',cookie);
assert.equal(policy.status,200);
const p=(await policy.json()).local;
assert.ok(p&&typeof p==='object');
assert.equal(p.platformAdapter,'linux');
assert.equal(p.enrolled,false,'UAT must not impersonate a real enrolled device');
assert.equal(p.cloudState,'dormant');
assert.equal(p.deviceId,null);
assert.equal(p.executorProbe.ready,true,'actual Gold executor probe must have run');
console.log('FULL_GOLD_AGENT_REAL_UNENROLLED_POLICY_AND_EXECUTOR_PROBE_PASS');
const page=await get('/projects',cookie);
assert.equal(page.status,200);
const html=await page.text();
assert.ok(html.includes('id="continuityModules"'));
assert.ok(html.indexOf('id="continuityModules"')<html.indexOf('class="layout"'));
assert.ok(html.includes('id="globalMemoryArea"'));
const inline=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(inline);
new vm.Script(inline);
const settings=await get('/api/project-continuity/getGlobalModules',cookie);
assert.equal(settings.status,200);
const global=(await settings.json());
assert.equal(global.ok,true);
assert.equal(typeof global.result.memoryEnabled,'boolean');
assert.equal(typeof global.result.codexEnabled,'boolean');
assert.match(global.result.defaultScopeId,/^[a-f0-9-]{36}$/);
const projects=await get('/api/project-continuity/listProjects',cookie);
assert.equal(projects.status,200);
assert.equal((await projects.json()).ok,true);
console.log('FULL_GOLD_AGENT_DEVICE_WIDE_MODULES_READ_NO_PROJECT_GATE_PASS');
console.log('FULL_GOLD_AGENT_LOCAL_WALL_LOGIN_AND_NO_ANON_API_PASS');
