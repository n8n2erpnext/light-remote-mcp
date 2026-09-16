import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const result=spawnSync('npm',['test','--prefix','plugin-server'],{cwd:root,stdio:'inherit',timeout:30000});
if(result.error) throw result.error;
if(result.status!==0) process.exit(result.status||1);
console.log('v11-openai-plugin=PASS');
