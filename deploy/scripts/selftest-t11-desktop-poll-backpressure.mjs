import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const app=read('client/desktop-v4/src/App.tsx');
const poller=read('client/desktop-v4/src/lib/scoped-read-poller.ts');
const test=read('client/desktop-v4/src/lib/scoped-read-poller.test.ts');
const win=read('.github/workflows/windows-native-client.yml');
const ci=read('.github/workflows/ci.yml');
const plan=JSON.parse(read('deploy/unified/test-plan.json'));
assert.match(app,/startScopedReadPoller\(\{\s*intervalMs:20_000,[\s\S]*?task:\(\)=>nativeOwnerSnapshot\(accountId\)/);
assert.match(app,/startScopedReadPoller\(\{\s*intervalMs:8000,[\s\S]*?task:nativeAbv2Pending/);
assert.match(app,/const refreshAbv2=useCallback\(\(\)=>\{\s*if\(nativeAbv2Pilot\)abv2Poller\.current\?\.refreshNow\(\)/);
assert.match(app,/if\(result\.state==='granted'\)refreshAbv2\(\)/);
assert.doesNotMatch(app,/window\.setInterval\(load,20_000\)|window\.setInterval\(refreshAbv2,8000\)/);
assert.match(poller,/let inFlight=false;/);
assert.match(poller,/let pending=false;/);
assert.match(poller,/let revision=0;/);
assert.match(poller,/if\(active&&!document\.hidden&&requestRevision===revision\)/);
assert.match(poller,/if\(inFlight\)\{pending=true;return;\}/);
assert.match(poller,/Math\.min\(maxRetryMs,intervalMs\*2\*\*failures\)/);
assert.match(poller,/document\.addEventListener\('visibilitychange',onVisibility\)/);
assert.match(poller,/document\.removeEventListener\('visibilitychange',onVisibility\)/);
assert.match(poller,/active=false;/);
for(const term of ['never overlaps a slow Owner snapshot','manual refresh after Approve',
  'Owner change/unmount','hidden UI','backs off']){
  assert.ok(test.includes(term),'missing actual delayed IPC simulation: '+term);
}
assert.ok(win.includes('selftest-t11-desktop-poll-backpressure.mjs'));
assert.ok(ci.includes('npm test'));
assert.ok(plan.sourceRegressions.includes('deploy/scripts/selftest-t11-desktop-poll-backpressure.mjs'));
console.log('T11_F09_P02_OWNER_SCOPED_NATIVE_READ_SINGLEFLIGHT_VISIBILITY_RETRY_SOURCE=PASS');
