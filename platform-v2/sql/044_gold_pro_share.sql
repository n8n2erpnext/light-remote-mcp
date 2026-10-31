-- P2-I4 SOURCE CANDIDATE ONLY. Not in migrations.lock.json.
-- Owner + exactly one Free (or other eligible) guest. Independent of Pro Team.
-- Do NOT apply to Gold UAT or production before integrated release sign-off.
BEGIN;
-- Widen the existing native A/B registry for cross-account delegation rather
-- than creating a second A/B engine. Preserve original owner constraints:
-- device grants MUST have the connection owner as actor; Guest grants MUST NOT.
-- A server-side trigger derives owner from the immutable connection record.
-- The separate Pro Share seat/device/approval checks remain mandatory in code.
ALTER TABLE lr_ab_requests DROP CONSTRAINT lr_ab_requests_purpose_check;
ALTER TABLE lr_ab_requests ADD CONSTRAINT lr_ab_requests_purpose_check
 CHECK(purpose IN ('device','team-member','pro-share-guest'));
ALTER TABLE lr_ab_grants DROP CONSTRAINT lr_ab_grants_purpose_check;
ALTER TABLE lr_ab_grants ADD CONSTRAINT lr_ab_grants_purpose_check
 CHECK(purpose IN ('device','team-member','pro-share-guest'));
ALTER TABLE lr_ab_grants ADD COLUMN connection_owner_account_id TEXT
 REFERENCES lr_accounts(account_id);
UPDATE lr_ab_grants g SET connection_owner_account_id=c.account_id
 FROM lr_device_connections c
 WHERE c.connection_id=g.connection_id AND c.device_id=g.device_id;
ALTER TABLE lr_ab_grants ALTER COLUMN connection_owner_account_id SET NOT NULL;
CREATE FUNCTION lr_gold_pro_share_ab_owner_from_connection()
 RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 SELECT account_id INTO NEW.connection_owner_account_id
 FROM lr_device_connections
 WHERE connection_id=NEW.connection_id AND device_id=NEW.device_id;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'invalid connection/device' USING ERRCODE='23503';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lr_gold_pro_share_ab_owner_guard
 BEFORE INSERT OR UPDATE OF connection_id,device_id,account_id,purpose
 ON lr_ab_grants FOR EACH ROW
 EXECUTE FUNCTION lr_gold_pro_share_ab_owner_from_connection();
ALTER TABLE lr_ab_grants
 -- PG004 already removed this legacy FK on actual Gold schema; retain
 -- PG004's two-column device+connection owner-independent FK and add the
 -- stronger connection-owner triple FK below.
 DROP CONSTRAINT IF EXISTS lr_ab_grants_connection_id_device_id_account_id_fkey;
ALTER TABLE lr_ab_grants
 ADD CONSTRAINT lr_ab_grants_owner_connection_fk
 FOREIGN KEY(connection_id,device_id,connection_owner_account_id)
 REFERENCES lr_device_connections(connection_id,device_id,account_id);
ALTER TABLE lr_ab_grants
 ADD CONSTRAINT lr_ab_grants_purpose_actor_owner_scope
 CHECK(
  (purpose='device' AND account_id=connection_owner_account_id)
  OR purpose='team-member'
  OR (purpose='pro-share-guest' AND account_id<>connection_owner_account_id)
 );
-- PG004 deliberately requires direct grants for native Agent bindings.
-- The Guest must retain a distinct purpose and exact actor identity through
-- the existing composite FK; never switch all bindings to permissive text.
ALTER TABLE lr_agent_bindings DROP CONSTRAINT IF EXISTS lr_binding_direct_grant_only;
ALTER TABLE lr_agent_bindings
 ADD CONSTRAINT lr_binding_pro_share_or_device_only
 CHECK(grant_purpose IN ('device','pro-share-guest'));
CREATE TABLE lr_gold_pro_share_addons (
  owner_account_id TEXT PRIMARY KEY REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('trial','active','paused','revoked')),
  valid_until_ms BIGINT NOT NULL CHECK(valid_until_ms > 0),
  monthly_guest_call_budget INTEGER NOT NULL CHECK(monthly_guest_call_budget BETWEEN 1 AND 1000000),
  source VARCHAR(70) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE lr_gold_pro_share_seats (
  owner_account_id TEXT PRIMARY KEY REFERENCES lr_gold_pro_share_addons(owner_account_id) ON DELETE CASCADE,
  guest_account_id TEXT REFERENCES lr_accounts(account_id) ON DELETE CASCADE,
  invited_email VARCHAR(254),
  invite_hash CHAR(64) CHECK(invite_hash ~ '^[a-f0-9]{64}$'),
  invite_expires_ms BIGINT,
  status TEXT NOT NULL DEFAULT 'empty' CHECK(status IN ('empty','invited','accepted')),
  accepted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(guest_account_id IS NULL OR guest_account_id <> owner_account_id),
  CHECK(
    (status = 'empty' AND guest_account_id IS NULL AND invite_hash IS NULL AND invited_email IS NULL AND invite_expires_ms IS NULL)
    OR (status = 'invited' AND guest_account_id IS NULL AND invite_hash IS NOT NULL AND invited_email IS NOT NULL AND invite_expires_ms > 0)
    OR (status = 'accepted' AND guest_account_id IS NOT NULL AND invite_hash IS NULL AND invited_email IS NULL AND invite_expires_ms IS NULL)
  )
);
CREATE UNIQUE INDEX lr_gold_pro_share_guest_seat_active
  ON lr_gold_pro_share_seats(guest_account_id) WHERE status = 'accepted';
CREATE TABLE lr_gold_pro_share_devices (
  owner_account_id TEXT NOT NULL REFERENCES lr_gold_pro_share_addons(owner_account_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_account_id,device_id)
);
CREATE INDEX lr_gold_pro_share_devices_device_idx ON lr_gold_pro_share_devices(device_id);
CREATE TABLE lr_gold_pro_share_usage_events (
  owner_account_id TEXT NOT NULL REFERENCES lr_gold_pro_share_addons(owner_account_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL CHECK(length(operation_id) BETWEEN 16 AND 160),
  guest_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
  device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
  agent_id TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  period_utc INTEGER NOT NULL CHECK(period_utc BETWEEN 202001 AND 999912),
  units INTEGER NOT NULL CHECK(units BETWEEN 1 AND 10000),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_account_id,operation_id)
);
CREATE INDEX lr_gold_pro_share_usage_period_idx
  ON lr_gold_pro_share_usage_events(owner_account_id,period_utc);
-- No public/guest SQL privileges; only trusted Operator Gold app role can write.
GRANT SELECT,INSERT,UPDATE,DELETE ON
 lr_gold_pro_share_addons,lr_gold_pro_share_seats,
 lr_gold_pro_share_devices,lr_gold_pro_share_usage_events TO lr_gold_app;
COMMIT;
