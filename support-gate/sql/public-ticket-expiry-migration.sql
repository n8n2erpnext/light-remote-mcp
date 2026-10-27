-- Legacy 60-day expiry must not supersede the policy: close time + 14 days.
-- Expiry is now determined dynamically using native Libredesk conversations.closed_at.
BEGIN;
ALTER TABLE support_gate_public_ticket_access ALTER COLUMN expires_at DROP NOT NULL;
ALTER TABLE support_gate_public_ticket_access ALTER COLUMN expires_at DROP DEFAULT;
UPDATE support_gate_public_ticket_access SET expires_at=NULL
 WHERE expires_at IS NOT NULL AND revoked_at IS NULL;
COMMIT;
