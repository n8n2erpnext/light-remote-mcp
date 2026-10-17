-- Gold-only Site Announcement structured records; replaces plugin JSON file state.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_site_announcements (
  announcement_id UUID PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  title TEXT NOT NULL DEFAULT '' CHECK(length(title)<=110),
  message TEXT NOT NULL DEFAULT '' CHECK(length(message)<=400),
  theme TEXT NOT NULL DEFAULT 'brand',
  background CHAR(7) NOT NULL DEFAULT '#FFCC00',
  color CHAR(7) NOT NULL DEFAULT '#111418',
  link_color CHAR(7) NOT NULL DEFAULT '#111418',
  link_label TEXT NOT NULL DEFAULT '' CHECK(length(link_label)<=50),
  link_url TEXT NOT NULL DEFAULT '' CHECK(length(link_url)<=600),
  pages TEXT[] NOT NULL DEFAULT ARRAY['/'],
  audience TEXT NOT NULL DEFAULT 'site' CHECK(audience IN ('site','clients','both')),
  kind TEXT NOT NULL DEFAULT 'feature' CHECK(kind IN ('feature','update','maintenance','service')),
  platforms TEXT[] NOT NULL DEFAULT ARRAY['windows','macos','linux'],
  priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN -100 AND 100),
  dismissible BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lr_announcement_text_required CHECK(title<>'' OR message<>''),
  CONSTRAINT lr_announcement_date_order CHECK(starts_at IS NULL OR ends_at IS NULL OR ends_at>starts_at)
);
CREATE INDEX IF NOT EXISTS lr_site_announcements_active
  ON lr_site_announcements(priority DESC, updated_at DESC) WHERE enabled;
INSERT INTO lr_site_announcements (
 announcement_id,enabled,title,message,theme,background,color,link_color,link_label,
 link_url,pages,audience,kind,platforms,priority,dismissible
) VALUES (
 '6ad1f5d2-b087-4b52-8ea3-3fa4a89b3095',true,'LIGHT REMOTE',
 'Connect your devices securely with local A/B approval','brand','#FFCC00','#111418',
 '#111418','Download Light Remote →','/downloads',
 ARRAY['/','/downloads','/support'],'site','feature',
 ARRAY['windows','macos','linux'],0,true
) ON CONFLICT(announcement_id) DO NOTHING;
INSERT INTO lr_schema_migrations(version) VALUES(14) ON CONFLICT DO NOTHING;
COMMIT;
