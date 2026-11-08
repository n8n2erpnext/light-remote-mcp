// Gold-only ingress contract. Runtime nginx -t and physical RM Duplex are
// separately required; this guards source from silently re-buffering POST.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const config=fs.readFileSync(new URL('../gold-demo/nginx-gold.conf',import.meta.url),'utf8');
const exact=config.match(/location = \/device-channel\/stream \{([^}]+)\}/);
assert.ok(exact,'Gold preview needs a dedicated Device Duplex stream route');
const stream=exact[1];
assert.match(stream,/proxy_pass\s+http:\/\/[^;]+:5583;/);
assert.match(stream,/proxy_http_version\s+1\.1;/);
assert.match(stream,/proxy_request_buffering\s+off;/);
assert.match(stream,/proxy_buffering\s+off;/);
const fallback=config.match(/location \/ \{([^}]+)\}/);
assert.ok(fallback,'Gold preview general route must remain available');
assert.doesNotMatch(fallback[1],/proxy_request_buffering\s+off;/,
  'unbuffered uploads must be scoped to Duplex, not all endpoints');
console.log('G3_GOLD_NGINX_DUPLEX_UNBUFFERED_SCOPE=PASS');
