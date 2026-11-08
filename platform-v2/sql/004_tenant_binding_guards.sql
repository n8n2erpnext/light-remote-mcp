-- Preserve owner/device connection binding while allowing explicit member A/B grants.
-- Prevent an agent-client session from borrowing a grant issued to a different account.
-- UAT ONLY; non-destructive and idempotent for empty/consistent schemas.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS lr_devices_owner_pair_unique ON lr_devices(device_id,owner_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_connection_device_pair_unique ON lr_device_connections(connection_id,device_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_agent_client_account_pair_unique ON lr_agent_clients(client_session_id,account_id);
CREATE UNIQUE INDEX IF NOT EXISTS lr_grants_full_binding_unique ON lr_ab_grants(grant_id,device_id,connection_id,account_id,purpose);

DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lr_device_connections'::regclass AND conname='lr_connection_matches_device_owner') THEN
  ALTER TABLE lr_device_connections ADD CONSTRAINT lr_connection_matches_device_owner
   FOREIGN KEY(device_id,account_id) REFERENCES lr_devices(device_id,owner_account_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lr_ab_requests'::regclass AND conname='lr_ab_request_matches_connection_device') THEN
  ALTER TABLE lr_ab_requests ADD CONSTRAINT lr_ab_request_matches_connection_device
   FOREIGN KEY(connection_id,device_id) REFERENCES lr_device_connections(connection_id,device_id);
 END IF;
END $$;

-- The old triple FK incorrectly equated *member actor* and *owner of device*.
ALTER TABLE lr_ab_grants DROP CONSTRAINT IF EXISTS lr_ab_grants_connection_id_device_id_account_id_fkey;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lr_ab_grants'::regclass AND conname='lr_ab_grant_matches_connection_device') THEN
  ALTER TABLE lr_ab_grants ADD CONSTRAINT lr_ab_grant_matches_connection_device
   FOREIGN KEY(connection_id,device_id) REFERENCES lr_device_connections(connection_id,device_id);
 END IF;
END $$;

ALTER TABLE lr_agent_bindings ADD COLUMN IF NOT EXISTS account_id TEXT;
UPDATE lr_agent_bindings b SET account_id=c.account_id
 FROM lr_agent_clients c WHERE b.client_session_id=c.client_session_id AND b.account_id IS NULL;
ALTER TABLE lr_agent_bindings ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE lr_agent_bindings ADD COLUMN IF NOT EXISTS grant_purpose TEXT NOT NULL DEFAULT 'device';
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lr_agent_bindings'::regclass AND conname='lr_binding_direct_grant_only') THEN
  ALTER TABLE lr_agent_bindings ADD CONSTRAINT lr_binding_direct_grant_only CHECK(grant_purpose='device');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lr_agent_bindings'::regclass AND conname='lr_binding_same_actor_as_client') THEN
  ALTER TABLE lr_agent_bindings ADD CONSTRAINT lr_binding_same_actor_as_client
   FOREIGN KEY(client_session_id,account_id) REFERENCES lr_agent_clients(client_session_id,account_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='lr_agent_bindings'::regclass AND conname='lr_binding_same_actor_and_device_as_grant') THEN
  ALTER TABLE lr_agent_bindings ADD CONSTRAINT lr_binding_same_actor_and_device_as_grant
   FOREIGN KEY(grant_id,device_id,connection_id,account_id,grant_purpose)
   REFERENCES lr_ab_grants(grant_id,device_id,connection_id,account_id,purpose);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS lr_agent_bindings_owner_idx ON lr_agent_bindings(account_id,device_id);
INSERT INTO lr_schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
COMMIT;
