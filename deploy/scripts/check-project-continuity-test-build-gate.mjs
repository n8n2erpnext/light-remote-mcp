import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const file=path.join(root,'docs/optimization/LIGHT_REMOTE_PROJECT_CONTINUITY_RELEASE_GATES_20261023.json');
const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
if(manifest.feature!=='Light Remote Project Continuity'||manifest.schema!==1)throw Error('continuity_invalid_build_gate');
const blocked=Object.entries(manifest.gates).filter(([,value])=>value!=='PASS');
const allowed=manifest.status==='READY'&&manifest.test_build_allowed===true&&blocked.length===0;
if(!allowed){
 console.error('CONTINUITY_TEST_BUILD_BLOCKED');
 for(const [key,value] of blocked)console.error(key+': '+value);
 process.exitCode=3;
}else console.log('CONTINUITY_TEST_BUILD_ELIGIBLE: evidence still required for physical UAT');
