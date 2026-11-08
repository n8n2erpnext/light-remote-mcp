-- Gold native site analytics: counters and dimensions are relational.
-- Deliberately reject legacy JSONB rows, never silently discard traffic metrics.
BEGIN;
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM lr_site_analytics_daily LIMIT 1) THEN
   RAISE EXCEPTION 'gold_site_analytics_legacy_rows_require_explicit_conversion';
 END IF;
END $$;
DROP TABLE lr_site_analytics_daily;
CREATE TABLE lr_site_analytics_daily(
 day DATE PRIMARY KEY,
 page_views BIGINT NOT NULL DEFAULT 0 CHECK(page_views>=0),
 downloads BIGINT NOT NULL DEFAULT 0 CHECK(downloads>=0),
 download_clicks BIGINT NOT NULL DEFAULT 0 CHECK(download_clicks>=0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE lr_site_analytics_dimensions(
 day DATE NOT NULL REFERENCES lr_site_analytics_daily(day) ON DELETE CASCADE,
 dimension TEXT NOT NULL CHECK(dimension IN ('pages','os','referrers','downloadOS','downloadArchitecture','downloadVersions','downloadFiles','osTabs','externalClickOS','externalClickArchitecture','externalClickVersions')),
 value TEXT NOT NULL CHECK(length(value) BETWEEN 1 AND 180),
 count BIGINT NOT NULL DEFAULT 0 CHECK(count>=0),
 PRIMARY KEY(day,dimension,value)
);
CREATE INDEX lr_site_analytics_dimensions_by_dimension ON lr_site_analytics_dimensions(dimension,day);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_site_analytics_daily,lr_site_analytics_dimensions TO lr_gold_app;
COMMIT;
