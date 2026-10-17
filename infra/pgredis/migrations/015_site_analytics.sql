-- Structured anonymized Plugin site telemetry. No JSON/file durable state or raw IP.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_site_analytics_events (
  event_id UUID PRIMARY KEY,
  event_day DATE NOT NULL DEFAULT CURRENT_DATE,
  event_type TEXT NOT NULL CHECK(event_type IN ('page','download','download-click','tab')),
  page_path TEXT NOT NULL DEFAULT '' CHECK(length(page_path)<=100),
  os_name TEXT NOT NULL DEFAULT '' CHECK(length(os_name)<=40),
  referrer_host TEXT NOT NULL DEFAULT '' CHECK(length(referrer_host)<=120),
  download_file TEXT NOT NULL DEFAULT '' CHECK(length(download_file)<=180),
  architecture TEXT NOT NULL DEFAULT '' CHECK(length(architecture)<=20),
  app_version TEXT NOT NULL DEFAULT '' CHECK(length(app_version)<=50),
  CONSTRAINT lr_site_event_page CHECK(event_type<>'page' OR page_path<>''),
  CONSTRAINT lr_site_event_file CHECK(event_type NOT IN ('download','download-click') OR download_file<>'')
);
CREATE INDEX IF NOT EXISTS lr_site_analytics_day_type
  ON lr_site_analytics_events(event_day,event_type);
INSERT INTO lr_schema_migrations(version) VALUES(15) ON CONFLICT DO NOTHING;
COMMIT;
