import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const json=p=>JSON.parse(read(p));
const plugin=json('plugin.json');
const compat=json('.codex-plugin/plugin.json');
const mcp=json('mcp.json');
const iface=plugin.extensions?.['com.openai']?.interface||{};

assert.equal(plugin.$schema,'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(mcp.$schema,'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
assert.equal(mcp.mcpServers?.['light-remote']?.type,'streamable-http');
assert.equal(mcp.mcpServers?.['light-remote']?.url,'https://light-remote.thaiduy.digital/mcp');
assert.equal(iface.brandColor,'#FFCC00');
assert.equal(compat.interface?.brandColor,'#FFCC00');
assert.ok(!('screenshots' in iface));
assert.ok(!('screenshots' in (compat.interface||{})));
for(const asset of [iface.composerIcon,iface.logo]) assert.ok(fs.statSync(path.join(root,asset)).size>0,asset);

const expectedSkills=['connection-and-onboarding','fleet-and-device-governance','policy-and-observability','remote-operations'];
const found=fs.readdirSync(path.join(root,'skills'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort();
assert.deepEqual(found,expectedSkills);
for(const name of found){const body=read(`skills/${name}/SKILL.md`);assert.match(body,new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---`));}

const submission=read('docs/plugin/OPENAI_SUBMISSION.md');
assert.match(submission,/openai-reviewer@thaiduy\.digital/);
assert.doesNotMatch(submission,/openai-review@thaiduy\.digital/);
assert.match(submission,/upload the final four-skill bundle/i);
assert.doesNotMatch(read('index.html'),/official OpenAI Plugin/i);

for(const unit of ['light-remote-review-wall.service.d','light-remote-review-leaf-agent.service.d']){
  const body=read(`deploy/reviewer/systemd/${unit}/20-fleet-component-store.conf`);
  assert.match(body,/ReadWritePaths=\/home\/lightremote\/\.local\/share\/light-remote\/components\/fleet-wall/);
}
const fixtureDir=fs.mkdtempSync(path.join(process.env.TMPDIR||'/tmp','lr-review-policy-'));
const fixture=path.join(fixtureDir,'device.json');
fs.writeFileSync(fixture,JSON.stringify({enrollment:{deviceId:'review-main',grantableCapabilities:['filesystem','git','build-test','docker','lxd','systemctl','sudo-on-demand','terminal'],approvedCapabilities:['filesystem','git','build-test','docker','lxd','systemctl','sudo-on-demand','terminal']},policy:{serverPolicyRevision:1},effectiveCapabilities:[]}));
const seeded=spawnSync(process.execPath,[path.join(root,'deploy/reviewer/seed-reviewer-policy.mjs'),`--state=${fixture}`],{encoding:'utf8'});
assert.equal(seeded.status,0,seeded.stderr);
const seededState=JSON.parse(fs.readFileSync(fixture,'utf8'));
assert.deepEqual(seededState.effectiveCapabilities,['build-test','filesystem','git','terminal']);
for(const cap of ['docker','lxd','systemctl','sudo-on-demand']) assert.ok(seededState.policy.deniedCapabilities.includes(cap),cap);
fs.rmSync(fixtureDir,{recursive:true,force:true});

const executor=read('operator-host/executor.mjs');
assert.match(executor,/devices\.register\([\s\S]*capabilities:hostEffectiveCapabilities\(\)/);
assert.match(executor,/devices\.heartbeat\(DEVICE_ID,\{capabilities:hostEffectiveCapabilities\(\)\}\)/);

const workflow=read('.github/workflows/server-linux-build.yml');
for(const required of ["'plugin.json'","'mcp.json'","'skills/**'","'docs/plugin/**'","'deploy/reviewer/**'","'index.html'"]) assert.ok(workflow.includes(required),required);
console.log('v11-openai-submission-contract=PASS');
