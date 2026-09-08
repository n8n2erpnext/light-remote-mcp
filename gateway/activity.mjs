const MAX_EVENTS = 250;
const events = [];
const clients = new Set();
let sequence = 0;

function cleanText(value, max = 120) {
  if (value == null) return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, max);
}

export function recordActivity(input) {
  const event = {
    id: ++sequence,
    at: new Date().toISOString(),
    kind: cleanText(input.kind || 'event', 40),
    tool: cleanText(input.tool, 80),
    status: cleanText(input.status || 'info', 24),
    caller: cleanText(input.caller || 'unknown', 80),
    durationMs: Number.isFinite(input.durationMs) ? Math.round(input.durationMs) : null,
    detail: cleanText(input.detail, 160)
  };
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const payload = `id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
  console.log(`[activity] ${event.status} ${event.tool || event.kind} ${event.durationMs ?? '-'}ms ${event.caller}`);
  return event;
}
export function recentActivity(limit = 100) {
  return events.slice(-Math.max(1, Math.min(Number(limit) || 100, MAX_EVENTS))).reverse();
}

export function attachActivitySse(_req, res) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();
  clients.add(res);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, now: new Date().toISOString() })}\n\n`);
  for (const event of events.slice(-25)) {
    res.write(`id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
  }
  const timer = setInterval(() => res.write(`: keepalive ${Date.now()}\n\n`), 20000);
  res.on('close', () => {
    clearInterval(timer);
    clients.delete(res);
  });
}
