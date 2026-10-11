import test from 'node:test';
import assert from 'node:assert/strict';
import {report} from '../scripts/scale-static-audit.mjs';

test('source-only architecture audit tracks concrete MJS scale blockers',()=>{
 assert.equal(report.scope,'source-only');
 assert(report.findings.length>=12);
 assert(report.findings.every(x=>x.matched&&x.evidence.every(y=>y.line>0)));
 for(const id of ['sync-account-snapshot','sync-usage-snapshot',
   'volatile-oauth-replay','volatile-fleet-jobs','sync-billing-snapshot',
   'per-request-mcp-allocation','process-local-event-ring']){
   assert(report.findings.some(row=>row.id===id),id);
 }
 assert(report.findings.every(row=>/^operator-host\/|^plugin-server\//.test(row.file)));
});
