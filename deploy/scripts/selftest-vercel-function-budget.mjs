import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiDir = path.join(root, 'api');
const functions = fs.readdirSync(apiDir)
  .filter(name => name.endsWith('.js') && fs.statSync(path.join(apiDir, name)).isFile())
  .sort();
const maxFunctions = 12;
if (functions.length > maxFunctions) {
  throw new Error(`vercel_function_budget_exceeded:${functions.length}/${maxFunctions}:${functions.join(',')}`);
}
if (!functions.includes('operator.js')) throw new Error('unified_operator_function_missing');
console.log(`vercel-function-budget=${functions.length}/${maxFunctions}=PASS`);
console.log(`vercel-functions=${functions.join(',')}`);
