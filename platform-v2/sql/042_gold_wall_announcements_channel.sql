-- Gold P1-D Wall announcement channel is independent of Distribution/website.
-- Existing records retain their original audience; no implicit cross-posts.
BEGIN;
ALTER TABLE lr_site_announcements
  DROP CONSTRAINT IF EXISTS lr_site_announcements_audience_check;
ALTER TABLE lr_site_announcements
  ADD CONSTRAINT lr_site_announcements_audience_check
  CHECK(audience IN ('site','clients','both','wall'));
COMMIT;
