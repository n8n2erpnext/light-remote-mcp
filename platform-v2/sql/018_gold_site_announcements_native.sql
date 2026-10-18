-- Gold native PostgreSQL: structured announcements are first-class SQL columns.
-- Block conversion if legacy payload rows exist: no silent data loss.
BEGIN;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM lr_site_announcements LIMIT 1) THEN
    RAISE EXCEPTION 'gold_announcements_legacy_rows_require_explicit_conversion';
  END IF;
END $$;
DROP TABLE lr_site_announcements;
CREATE TABLE lr_site_announcements(
  id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 8 AND 100),
  enabled BOOLEAN NOT NULL DEFAULT false,
  title VARCHAR(110) NOT NULL,
  message VARCHAR(400) NOT NULL,
  theme VARCHAR(30) NOT NULL,
  background CHAR(7) NOT NULL,
  color CHAR(7) NOT NULL,
  link_color CHAR(7) NOT NULL,
  link_label VARCHAR(50) NOT NULL,
  link_url VARCHAR(600) NOT NULL,
  pages TEXT[] NOT NULL DEFAULT ARRAY['/']::TEXT[],
  audience TEXT NOT NULL CHECK(audience IN ('site','clients','both')),
  kind TEXT NOT NULL CHECK(kind IN ('feature','update','maintenance','service')),
  platforms TEXT[] NOT NULL DEFAULT ARRAY['windows','macos','linux']::TEXT[],
  priority SMALLINT NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100 AND 100),
  dismissible BOOLEAN NOT NULL DEFAULT true,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(end_at IS NULL OR start_at IS NULL OR end_at>start_at)
);
CREATE INDEX lr_site_announcements_priority
 ON lr_site_announcements(enabled,priority DESC,updated_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_site_announcements TO lr_gold_app;
COMMIT;
