-- Gold native PostgreSQL design: credential configuration uses typed SQL columns.
-- Legacy one-row JSON snapshot is no longer a canonical writer.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_gold_google_oauth_config(
  singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK(singleton_id=1),
  client_id TEXT NOT NULL CHECK(length(client_id) BETWEEN 20 AND 220),
  client_secret TEXT NOT NULL CHECK(length(client_secret) BETWEEN 16 AND 512),
  redirect_uri TEXT NOT NULL CHECK(length(redirect_uri)>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON lr_gold_google_oauth_config TO lr_gold_app;
COMMIT;
