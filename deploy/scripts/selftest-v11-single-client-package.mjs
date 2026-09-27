import fs from 'node:fs';
import assert from 'node:assert/strict';

const root=new URL('../../',import.meta.url);
const read=file=>fs.readFileSync(new URL(file,root),'utf8');
const csproj=read('client/windows-native/GptOperator.Client/GptOperator.Client.csproj');
const workflow=read('.github/workflows/windows-native-client.yml');
const installer=read('client/windows-native/installer/GptOperator.iss');

const baseline={
  commit:'93606ac7c0ec1295e01f58090c2c2fd6fd685426',
  fullBytes:102339829,
  compactBytes:81391960,
  maxGrowthRatio:1.25
};

assert.ok(read('client/windows-native/GptOperator.Client/RealRemoteInput.cs').includes('partial class RealRemoteHelper'));
assert.ok(!/Compile Remove=[^>]*RealRemote/i.test(csproj),'Real Remote must remain in the one Windows client build');
assert.ok(workflow.includes('Light-Remote-Setup-x64.exe')&&workflow.includes('Light-Remote-Compact-Setup-x64.exe'));
for(const forbidden of ['Light-Remote-Basic-','Light-Remote-RM-','Light-Remote-Real-Remote-'])assert.ok(!workflow.includes(forbidden),'separate Basic/RM installer variant is forbidden:'+forbidden);
assert.ok(installer.includes('AppName=Light Remote'));
assert.ok(!/AppName=.*(?:Basic|RM|Real Remote RM)/i.test(installer),'installer product must stay one Light Remote client');

const [fullPath,compactPath]=process.argv.slice(2);
if(Boolean(fullPath)!==Boolean(compactPath))throw new Error('pass both full and compact installer paths or neither');
if(fullPath&&compactPath){
  const full=fs.statSync(fullPath).size,compact=fs.statSync(compactPath).size;
  const fullLimit=Math.floor(baseline.fullBytes*baseline.maxGrowthRatio);
  const compactLimit=Math.floor(baseline.compactBytes*baseline.maxGrowthRatio);
  assert.ok(full<=fullLimit,`single_client_full_size_budget_exceeded:${full}>${fullLimit}`);
  assert.ok(compact<=compactLimit,`single_client_compact_size_budget_exceeded:${compact}>${compactLimit}`);
  const fullGrowth=((full/baseline.fullBytes-1)*100).toFixed(3);
  const compactGrowth=((compact/baseline.compactBytes-1)*100).toFixed(3);
  console.log(`windows-single-client-size-budget=PASS full=${full} growth=${fullGrowth}% compact=${compact} growth=${compactGrowth}% baseline=${baseline.commit}`);
}
console.log('windows-single-client-rm-capability-package=PASS');
