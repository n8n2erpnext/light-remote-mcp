-- Gold Connection Lifecycle GC (device-neutral, Free/Pro/VIP).
-- A server job may expire as UNKNOWN after 60m offline, but a process that
-- might still execute locally requires a durable resource fence.
BEGIN;
CREATE TABLE lr_gold_device_gc_fences(
  job_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  resource_mode TEXT NOT NULL CHECK(resource_mode IN ('shared','exclusive')),
  process_id TEXT CHECK(process_id IS NULL OR process_id ~ '^lp_[A-Za-z0-9_-]{20,80}$'),
  recovery_reason TEXT NOT NULL CHECK(recovery_reason IN
    ('connection_disconnected','plan_lease_expired','network_lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at TIMESTAMPTZ,
  resolution TEXT,
  CHECK ((resolved_at IS NULL AND resolution IS NULL) OR
    (resolved_at IS NOT NULL AND resolution IS NOT NULL))
);
CREATE INDEX lr_gold_gc_fences_pending ON lr_gold_device_gc_fences(device_id,resource_key)
  WHERE resolved_at IS NULL;
GRANT SELECT,INSERT,UPDATE ON lr_gold_device_gc_fences TO lr_gold_app;
COMMIT;
