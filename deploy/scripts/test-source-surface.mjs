import fs from 'node:fs';
import path from 'node:path';

const OPERATOR_SOURCE_FILES=[
  'operator-host/executor.mjs',
  'operator-host/executor-routes-account.mjs',
  'operator-host/executor-routes-device-channel.mjs',
  'operator-host/executor-routes-runtime.mjs'
];

export function readOperatorSourceSurface(root){
  return OPERATOR_SOURCE_FILES.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
}

export function operatorSourceFiles(){return [...OPERATOR_SOURCE_FILES];}
