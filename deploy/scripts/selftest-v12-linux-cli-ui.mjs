import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderLinuxStatus} from '../../client/linux/cli-status.mjs';

const root=fileURLToPath(new URL('../..',import.meta.url));
const cli=path.join(root,'client/linux/light-remote');
const cmd=path.join(root,'client/linux/cli-commands.sh');
const renderer=path.join(root,'client/linux/cli-status.mjs');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/linux-client-build.yml'),'utf8');
const connected={ok:true,version:'0.9.0-rc.46',deviceName:'VPS-AMD',cloudState:'connected',
  connectionPlan:'vip',deviceId:'secret-device-id',publicKeySha256:'secret-fingerprint',
  fleetWall:{healthy:false,port:5492},update:{state:'idle'}};
const rendered=renderLinuxStatus(connected,{host:'100.94.235.29',port:'5491',service:'active'});
for(const fragment of ['0.9.0-rc.46','VPS-AMD','Connected','VIP','http://100.94.235.29:5491/',
  'NetBird','light-remote bind','light-remote status --json','Not running'])
  assert.ok(rendered.includes(fragment),fragment);
for(const forbidden of ['secret-device-id','secret-fingerprint','direct-production-local','hardExpiresAt'])
  assert.ok(!rendered.includes(forbidden),'sensitive field rendered '+forbidden);
assert.match(renderLinuxStatus({...connected,cloudState:'dormant'},{host:'127.0.0.1',service:'inactive'}),/Local only/);
assert.match(renderLinuxStatus({...connected,fleetWall:{healthy:true}},{host:'192.168.1.3'}),/Fleet\s+: Online/);
console.log('linux-cli-human-readable-status-and-privacy=PASS');

for(const file of [cli,cmd]) {
  const check=spawnSync('bash',['-n',file],{encoding:'utf8'});
  assert.equal(check.status,0,check.stderr);
}
const nodeCheck=spawnSync(process.execPath,['--check',renderer],{encoding:'utf8'});
assert.equal(nodeCheck.status,0,nodeCheck.stderr);
assert.ok(workflow.includes('cp client/linux/cli-commands.sh client/linux/cli-status.mjs'));
assert.ok(workflow.includes('test -s "$PKG/client/linux/cli-status.mjs"'));
console.log('linux-cli-bundle-contract-and-shell-syntax=PASS');

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'light-remote-cli-'));
try {
  const bin=path.join(temp,'current/runtime/node');
  const agent=path.join(temp,'current/device-agent/operator-agent.mjs');
  const installed=path.join(temp,'current/client/linux');
  fs.mkdirSync(path.dirname(bin),{recursive:true});
  fs.mkdirSync(path.dirname(agent),{recursive:true});
  fs.mkdirSync(installed,{recursive:true});
  fs.copyFileSync(cmd,path.join(installed,'cli-commands.sh'));
  fs.copyFileSync(renderer,path.join(installed,'cli-status.mjs'));
  fs.writeFileSync(agent,'');
  const status=path.join(temp,'status.json');
  fs.writeFileSync(status,JSON.stringify(connected));
  const wrapper='#!/bin/sh\nif [ "$2" = status ]; then cat "$FAKE_STATUS_FILE"; else exec "'+process.execPath+'" "$@"; fi\n';
  fs.writeFileSync(bin,wrapper,{mode:0o755});
  const env={...process.env,LIGHT_REMOTE_ROOT:temp,LIGHT_REMOTE_SERVICE:'light-remote-fixture-not-installed.service',
    FAKE_STATUS_FILE:status};
  const run=(args)=>spawnSync('bash',[cli,...args],{env,encoding:'utf8'});
  const friendly=run(['status']);
  assert.equal(friendly.status,0,friendly.stderr);
  assert.match(friendly.stdout,/Light Remote  0\.9\.0-rc\.46/);
  assert.doesNotMatch(friendly.stdout,/publicKeySha256|deviceId|hardExpiresAt/);
  const raw=run(['status','--json']);
  assert.equal(raw.status,0,raw.stderr);
  assert.equal(JSON.parse(raw.stdout).deviceId,connected.deviceId);
  assert.equal(run(['bind','--host','8.8.8.8']).status,2,'public IP bind must be rejected');
  assert.match(run(['help']).stdout,/bind --netbird/);
  console.log('linux-cli-real-wrapper-status-json-and-bind-guard=PASS');
} finally {
  fs.rmSync(temp,{recursive:true,force:true});
}
console.log('LINUX_FRIENDLY_CLI_GATE=PASS');
