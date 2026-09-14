import fs from 'node:fs';
const src=fs.readFileSync(new URL('../../operator-host/executor.mjs',import.meta.url),'utf8');
function need(v,m){if(!v)throw new Error(m);}
need(src.includes('RING_HARD_CAP_BYTES = 10 * 1024 * 1024'),'ring_hard_cap_missing');
need(src.includes('OPERATOR_RING_BYTES || 8 * 1024 * 1024'),'ring_default_8mib_missing');
need(src.includes('OPERATOR_RING_AGE_MS || 15 * 60 * 1000'),'ring_age_15m_missing');
need(src.includes('OPERATOR_DISK_FLUSH_MS || 50'),'disk_flush_50ms_missing');
need(src.includes('fs.promises.appendFile(LOG_FILE'),'async_disk_append_missing');
need(!src.includes('fs.appendFileSync(LOG_FILE'),'sync_log_append_survived');
const push=src.slice(src.indexOf('function pushEvent(input)'),src.indexOf('if (devices.loadError)'));
const sse=push.indexOf('sseClients'),usage=push.indexOf('usage.ingest'),disk=push.indexOf('queueDiskRecord');
need(sse>=0&&usage>sse&&disk>usage,'hot_path_not_sse_first');
need(src.includes('function recentEvents(limit = 500, deviceId = null) {\n  pruneRing();'),'recent_events_must_prune_age');
need(src.includes('void flushDiskRecords().finally'),'shutdown_disk_flush_missing');
console.log('v09-wall-hot-stream=PASS');
