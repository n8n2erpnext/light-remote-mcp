import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const plan=JSON.parse(fs.readFileSync(path.join(root,'deploy/unified/test-plan.json'),'utf8'));
const onlySource=process.argv.includes('--source-only'),failed=[];let passed=0;
if(!onlySource){
 const units=plan.unitDirectories.flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(n=>n.endsWith('.test.mjs')).map(n=>dir+'/'+n));
 const unit=spawnSync(process.execPath,['--test','--test-concurrency=4','--test-timeout=30000',...units,...(plan.extraUnitFiles||[])],{cwd:root,stdio:'inherit'});
 if(unit.status!==0)failed.push('node-unit-suite');else passed++;
}
for(const rel of plan.sourceRegressions){
 if(!/^deploy\/scripts\/selftest-[A-Za-z0-9_.-]+\.mjs$/.test(rel))throw Error('unified_test_path_invalid');
 console.log('UNIFIED_SOURCE_TEST '+rel);
 const r=spawnSync(process.execPath,[rel,...(plan.sourceArguments?.[rel]||[])],{cwd:root,stdio:'inherit',timeout:45000});
 if(r.status!==0)failed.push(rel);else passed++;
}
console.log('UNIFIED_TEST_SUMMARY='+JSON.stringify({passed,failed,deferred:plan.notInPortableSuite}));
if(failed.length)process.exitCode=1;
