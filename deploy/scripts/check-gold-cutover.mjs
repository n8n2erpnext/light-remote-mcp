// Read-only source cutover audit; no credentials, database, devices or runtime effects.
// Exit 3 = not full Gold. This check is NECESSARY but not sufficient for sign-off.
import {inspectGoldPgOnlyCutover} from '../../lib/gold-pg-only-gate.mjs';
const state=inspectGoldPgOnlyCutover();
console.log(JSON.stringify({
 status:state.ok?'SOURCE_CUTOVER_CANDIDATE':'BLOCKED_SOURCE_CUTOVER',
 required:state.required,complete:state.complete,unresolved:state.unresolved,
 blockers:state.domains.filter(x=>!x.complete).map(x=>({
  role:x.role,domain:x.name,file:x.file,
  legacyWriterOrVolatileAuthority:x.legacyPresent,
  postgresRouteNotProven:!x.pgWired
 })),
 limitations:[
  'Source markers are necessary, not sufficient evidence of correct database wiring.',
  'A successful check does not verify real PostgreSQL, Redis, migrations, business writes, restarts, OAuth, A/B, billing, clients, or full API acceptance.',
  'Operational secrets and diagnostic JSON/log files are not business databases.',
  'No production process or remote database has been inspected or changed.'
 ]
},null,2));
if(!state.ok)process.exitCode=3;
