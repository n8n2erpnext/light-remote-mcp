import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),dir=path.join(root,'deploy/scripts'),portable=process.argv.includes('--portable')||!process.argv.includes('--all');
const tests=fs.readdirSync(dir).filter(name=>/^selftest-.*\.mjs$/.test(name)).sort(),skipped=[],failed=[];let passed=0;
for(const name of tests){if(portable&&name==='selftest-systemd.mjs'){skipped.push(name);console.log(`==> ${name} (live-host acceptance skipped)`);continue;}console.log(`==> ${name}`);const result=spawnSync(process.execPath,[path.join(dir,name)],{cwd:root,stdio:'inherit',timeout:40000});if(result.status===0){passed++;continue;}failed.push({name,status:result.status,signal:result.signal,error:result.error?.code||null});}
console.log(`selftest_summary total=${tests.length} passed=${passed} failed=${failed.length} skipped=${skipped.length} mode=${portable?'portable':'all'}`);
if(failed.length){for(const row of failed)console.error(`selftest_failed name=${row.name} status=${row.status} signal=${row.signal||''} error=${row.error||''}`);process.exit(1);}
