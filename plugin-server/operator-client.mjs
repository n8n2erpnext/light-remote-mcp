import http from 'node:http';
import { MAX_PROXY_BODY, OPERATOR_SOCKET } from './config.mjs';

function request(method, targetPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      socketPath: OPERATOR_SOCKET,
      method,
      path: targetPath,
      headers: {
        accept: 'application/json',
        ...(payload ? {'content-type':'application/json','content-length':payload.length} : {}),
        ...headers
      }
    }, res => {
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_PROXY_BODY) {
          req.destroy(new Error('operator_response_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({status:res.statusCode || 502, headers:res.headers, body:Buffer.concat(chunks)}));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export async function callOperatorJson(method, targetPath, body = null, headers = {}) {
  const upstream = await request(method, targetPath, body, headers);
  const text = upstream.body.toString('utf8');
  let data;
  try { data = JSON.parse(text); } catch { data = {raw:text}; }
  if (upstream.status < 200 || upstream.status >= 300) {
    const error = new Error(data?.error || `operator_http_${upstream.status}`);
    error.status = upstream.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export function proxyOperatorDuplex(req, res, targetPath='/v1/device-channel/stream') {
  let settled = false;
  const upstream = http.request({
    socketPath: OPERATOR_SOCKET,
    method:'POST',
    path:targetPath,
    headers:{
      'content-type':req.headers['content-type'] || 'application/x-ndjson',
      accept:'application/x-ndjson',
      'cache-control':'no-store'
    }
  }, source => {
    res.status(source.statusCode || 502);
    res.set({
      'Content-Type':source.headers['content-type'] || 'application/x-ndjson; charset=utf-8',
      'Cache-Control':'no-store',
      Connection:'keep-alive',
      'X-Accel-Buffering':'no'
    });
    res.flushHeaders?.();
    source.pipe(res);
    source.on('end', () => { settled = true; });
    source.on('error', () => { if (!res.writableEnded) res.end(); });
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ok:false,error:'operator_unavailable'});
    else if (!res.writableEnded) res.end();
  });
  req.on('aborted', () => upstream.destroy());
  req.on('error', () => upstream.destroy());
  res.on('close', () => { if (!settled) upstream.destroy(); });
  req.pipe(upstream);
}
