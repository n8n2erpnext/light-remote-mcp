import http from 'node:http';

const SOCKET_PATH = process.env.OPERATOR_SOCKET || '/run/gpt-vps-operator/operator.sock';
const MAX_PROXY_BODY = Number(process.env.OPERATOR_PROXY_BODY || 10 * 1024 * 1024);

function requestSocket(method, targetPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({ socketPath: SOCKET_PATH, method, path: targetPath, headers: {
      accept: 'application/json', ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers
    } }, upstream => {
      const chunks = [];
      let size = 0;
      upstream.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_PROXY_BODY) { req.destroy(new Error('operator_response_too_large')); return; }
        chunks.push(chunk);
      });
      upstream.on('end', () => resolve({ status: upstream.statusCode || 502, headers: upstream.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}


export async function callOperatorJson(method, targetPath, body = null) {
  const upstream = await requestSocket(method, targetPath, body);
  const text = upstream.body.toString('utf8');
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw:text }; }
  if (upstream.status < 200 || upstream.status >= 300) {
    const error = new Error(payload?.error || `operator_http_${upstream.status}`);
    error.status = upstream.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function proxyOperatorJson(res, method, targetPath, body = null) {
  try {
    const upstream = await requestSocket(method, targetPath, body);
    res.status(upstream.status);
    res.set('Cache-Control', 'no-store');
    const type = upstream.headers['content-type'];
    if (type) res.set('Content-Type', type);
    return res.send(upstream.body);
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.message || 'operator_unavailable' });
  }
}

export function proxyOperatorSse(_req, res) {
  const upstream = http.request({ socketPath: SOCKET_PATH, method: 'GET', path: '/v1/events', headers: { accept: 'text/event-stream' } }, source => {
    res.status(source.statusCode || 502);
    res.set({
      'Content-Type': source.headers['content-type'] || 'text/event-stream',
      'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
    });
    res.flushHeaders?.();
    source.pipe(res);
    source.on('error', () => res.end());
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ ok: false, error: 'operator_unavailable' });
    else res.end();
  });
  res.on('close', () => upstream.destroy());
  upstream.end();
}

export { SOCKET_PATH };
