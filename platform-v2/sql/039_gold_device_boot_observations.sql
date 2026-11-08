-- Device-authenticated Windows OS-uptime telemetry is read-only diagnostic.
-- It is NOT Windows LastBootUpTime, a terminal receipt or owner recovery proof.
-- Neither this schema nor ingestion can update M4 claims or ACKs.
BEGIN;
CREATE TABLE lr_gold_device_boot_observations(
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  sampled_at_ms BIGINT NOT NULL CHECK(sampled_at_ms>1577836800000),
  boot_estimate_ms BIGINT NOT NULL CHECK(boot_estimate_ms>1577836800000),
  system_uptime_ms BIGINT NOT NULL CHECK(system_uptime_ms>=5000),
  agent_uptime_ms BIGINT NOT NULL CHECK(agent_uptime_ms>=0),
  source TEXT NOT NULL CHECK(source='win32_node_os_uptime'),
  assurance TEXT NOT NULL CHECK(assurance='estimate_only'),
  agent_version VARCHAR(100) NOT NULL,
  native_boot_at_ms BIGINT,
  native_observed_at_ms BIGINT,
  native_source TEXT CHECK (native_source='win32_wmi_lastbootuptime'),
  native_consistency TEXT CHECK (native_consistency IN ('consistent','divergent')),
  CHECK (
    (native_boot_at_ms IS NULL AND native_observed_at_ms IS NULL AND native_source IS NULL AND native_consistency IS NULL)
    OR
    (native_boot_at_ms>1577836800000 AND native_observed_at_ms>=native_boot_at_ms-30000
       AND native_source IS NOT NULL AND native_consistency IS NOT NULL)
  ),
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,device_id),
  CHECK(boot_estimate_ms<=sampled_at_ms)
);
GRANT SELECT,INSERT,UPDATE ON lr_gold_device_boot_observations TO lr_gold_app;
COMMIT;
