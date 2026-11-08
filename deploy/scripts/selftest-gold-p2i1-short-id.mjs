import assert from 'node:assert/strict';
import {resolvePermittedDeviceTarget,SHORT_ID_ALPHABET,SHORT_ID_RE} from '../../lib/gold-device-short-id.mjs';
assert.equal(SHORT_ID_ALPHABET.length,32);
assert.match('0HJK7V',SHORT_ID_RE);
for(const invalid of ['OO1234','ILI234','UU1234','abc123'])assert.ok(!SHORT_ID_RE.test(invalid));
const allowed=[
 {deviceId:'d1',shortId:'ABCD02',displayName:'Windows 10',nodeId:'node1',platform:'windows',state:'online'},
 {deviceId:'d2',shortId:'GHJK45',displayName:'Windows 11',nodeId:'node2',platform:'windows',state:'offline'},
 {deviceId:'d3',shortId:'MNPQ67',displayName:'VPS ARM',nodeId:'node3',platform:'linux',state:'online'}
];
let r=resolvePermittedDeviceTarget({permittedDevices:allowed,query:'ABCD02'});
assert.equal(r.status,'single');assert.equal(r.matches[0].deviceId,'d1');
r=resolvePermittedDeviceTarget({permittedDevices:allowed,query:'windows'});
assert.equal(r.status,'ambiguous');assert.equal(r.total,2);assert.equal(r.matches.length,2);
assert.equal(resolvePermittedDeviceTarget({permittedDevices:allowed,query:'private'}).status,'not_found');
assert.equal(resolvePermittedDeviceTarget({permittedDevices:allowed.slice(0,1),query:'GHJK45'}).status,'not_found');
const repeated=resolvePermittedDeviceTarget({permittedDevices:[...allowed,allowed[0]],query:'Windows'});
assert.equal(repeated.total,2,'duplicate device must not duplicate results');
for(const q of ['', ' '.repeat(5), 'x'.repeat(121), 'bad\nvalue'])
 assert.throws(()=>resolvePermittedDeviceTarget({permittedDevices:allowed,query:q}),/gold_target_query_invalid/);
assert.throws(()=>resolvePermittedDeviceTarget({permittedDevices:allowed,query:'Windows',limit:6}),/gold_target_scope_invalid/);
assert.deepEqual(Object.keys(r.matches[0]).sort(),['deviceId','displayName','online','platform','shortId']);
console.log('GOLD_P2I1_SCOPED_RESOLVER_NO_GRANT_AMBIGUITY=PASS');
