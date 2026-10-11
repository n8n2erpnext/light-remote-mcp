-- Isolated UAT. Challenge must be issued and crypto-verified by a trusted
-- server-side Ed25519 verifier. This SQL never accepts a client family ID.
BEGIN;
CREATE TABLE IF NOT EXISTS lr_device_identity_keys_uat (
 device_id TEXT PRIMARY KEY REFERENCES lr_devices(device_id),
 public_spki_base64 TEXT NOT NULL CHECK(length(public_spki_base64) BETWEEN 40 AND 350),
 public_key_sha256 TEXT NOT NULL CHECK(public_key_sha256 ~ '^[0-9a-f]{64}$'),
 verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS lr_free_rotation_challenges (
 challenge_id TEXT PRIMARY KEY CHECK(length(challenge_id) BETWEEN 1 AND 160),
 old_device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
 new_device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
 old_owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 new_owner_account_id TEXT NOT NULL REFERENCES lr_accounts(account_id),
 source_family_id TEXT NOT NULL REFERENCES lr_free_families(family_id),
 old_key_sha256 TEXT NOT NULL CHECK(old_key_sha256 ~ '^[0-9a-f]{64}$'),
 new_key_sha256 TEXT NOT NULL CHECK(new_key_sha256 ~ '^[0-9a-f]{64}$'),
 nonce_sha256 TEXT NOT NULL UNIQUE CHECK(nonce_sha256 ~ '^[0-9a-f]{64}$'),
 issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 expires_at TIMESTAMPTZ NOT NULL,
 consumed_at TIMESTAMPTZ,
 CHECK(old_device_id<>new_device_id),
 CHECK(expires_at>issued_at AND expires_at<=issued_at+interval '5 minutes'),
 CHECK(consumed_at IS NULL OR consumed_at>=issued_at)
);
ALTER TABLE lr_free_rotation_challenges ADD COLUMN IF NOT EXISTS source_family_id TEXT REFERENCES lr_free_families(family_id);
ALTER TABLE lr_free_rotation_challenges ALTER COLUMN source_family_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS lr_free_rotation_expiry_idx
 ON lr_free_rotation_challenges(expires_at) WHERE consumed_at IS NULL;
CREATE TABLE IF NOT EXISTS lr_free_rotation_audit (
 challenge_id TEXT PRIMARY KEY REFERENCES lr_free_rotation_challenges(challenge_id),
 old_device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
 new_device_id TEXT NOT NULL REFERENCES lr_devices(device_id),
 family_id TEXT NOT NULL REFERENCES lr_free_families(family_id),
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION lr_finalize_free_rotation_uat(
 p_challenge TEXT,p_nonce_hash TEXT,p_old_key_hash TEXT,p_new_key_hash TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
 c lr_free_rotation_challenges%ROWTYPE;
 old_id lr_devices%ROWTYPE;
 new_id lr_devices%ROWTYPE;
 family TEXT;
 now_ts TIMESTAMPTZ:=clock_timestamp();
BEGIN
 SELECT * INTO c FROM lr_free_rotation_challenges
  WHERE challenge_id=p_challenge FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown_rotation_challenge' USING ERRCODE='check_violation'; END IF;
 IF c.consumed_at IS NOT NULL THEN RETURN FALSE; END IF;
 IF c.expires_at<=now_ts OR c.issued_at>now_ts THEN
  RAISE EXCEPTION 'rotation_challenge_expired' USING ERRCODE='check_violation'; END IF;
 IF p_nonce_hash IS DISTINCT FROM c.nonce_sha256
  OR p_old_key_hash IS DISTINCT FROM c.old_key_sha256
  OR p_new_key_hash IS DISTINCT FROM c.new_key_sha256 THEN
  RAISE EXCEPTION 'rotation_challenge_mismatch' USING ERRCODE='check_violation'; END IF;
 -- The trusted verification service has already checked BOTH device Ed25519
 -- signatures against the canonical challenge and authenticated owner contexts.
 -- DB also requires the registered key fingerprints to remain unchanged.
 IF NOT EXISTS(SELECT 1 FROM lr_device_identity_keys_uat
   WHERE device_id=c.old_device_id AND public_key_sha256=c.old_key_sha256)
 OR NOT EXISTS(SELECT 1 FROM lr_device_identity_keys_uat
   WHERE device_id=c.new_device_id AND public_key_sha256=c.new_key_sha256) THEN
  RAISE EXCEPTION 'rotation_identity_key_changed' USING ERRCODE='check_violation'; END IF;
 -- Two account/device locks ensure identities cannot be revoked/switch owners
 -- between validation and creation of the new family binding.
 PERFORM 1 FROM lr_accounts WHERE account_id IN
  (c.old_owner_account_id,c.new_owner_account_id) AND status='active' AND plan='free'
  ORDER BY account_id FOR SHARE;
 PERFORM 1 FROM lr_devices WHERE device_id IN(c.old_device_id,c.new_device_id)
  ORDER BY device_id FOR UPDATE;
 SELECT * INTO old_id FROM lr_devices WHERE device_id=c.old_device_id;
 SELECT * INTO new_id FROM lr_devices WHERE device_id=c.new_device_id;
 IF NOT FOUND OR old_id.owner_account_id<>c.old_owner_account_id
  OR new_id.owner_account_id<>c.new_owner_account_id
  OR old_id.state='revoked' OR new_id.state='revoked'
  OR NOT EXISTS(SELECT 1 FROM lr_accounts WHERE account_id=c.old_owner_account_id AND status='active' AND plan='free')
  OR NOT EXISTS(SELECT 1 FROM lr_accounts WHERE account_id=c.new_owner_account_id AND status='active' AND plan='free') THEN
  RAISE EXCEPTION 'rotation_device_account_invalid' USING ERRCODE='check_violation'; END IF;
 SELECT family_id INTO family FROM lr_free_family_devices
  WHERE device_id=c.old_device_id FOR SHARE;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'rotation_source_family_unverified' USING ERRCODE='check_violation'; END IF;
 IF family<>c.source_family_id THEN
  RAISE EXCEPTION 'rotation_source_family_changed' USING ERRCODE='check_violation'; END IF;
 -- Fail closed: never merge two established families without a separate
 -- historical quota reconciliation + fencing protocol.
 IF EXISTS(SELECT 1 FROM lr_free_family_devices WHERE device_id=c.new_device_id) THEN
  RAISE EXCEPTION 'rotation_target_already_family_bound' USING ERRCODE='check_violation'; END IF;
 INSERT INTO lr_free_family_devices(device_id,family_id)
  VALUES(c.new_device_id,family);
 UPDATE lr_free_rotation_challenges SET consumed_at=now_ts
  WHERE challenge_id=p_challenge AND consumed_at IS NULL;
 INSERT INTO lr_free_rotation_audit(challenge_id,old_device_id,new_device_id,family_id)
  VALUES(p_challenge,c.old_device_id,c.new_device_id,family);
 RETURN TRUE;
END $$;
REVOKE EXECUTE ON FUNCTION lr_finalize_free_rotation_uat(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
INSERT INTO lr_schema_migrations(version) VALUES(12) ON CONFLICT DO NOTHING;
COMMIT;
