# Gold account-wide scoped Memory deletion (2026-10-26)

## Design
The same Gold Wall provides the owner-facing action and status. No new UI library,
second Wall, or server storing Memory payload is created.

- Home signs an immutable scope deletion command using its private Ed25519 key.
- The server verifies the enrollment-signed Home Agent and its advertised key;
  metadata-only PostgreSQL migration 037 persists the request and its target rows.
- Every enrolled, non-revoked device at request time is a target, even if offline.
- The Home locally purges only after durable server acceptance, then ACKs.
- Agents poll for pending account deletion even when ordinary Sync is OFF.
  Each validates signed Home authority, persists a local deletion tombstone,
  then signs its acknowledgment using the existing enrolled Device Channel.
- Backend rejects new invitations and relayed frames for the deleted scope.
  Local tombstones also reject later attempts to reimport old checkpoints.
- Pending until every originally targeted device ACKs; only then Completed.
- The UI shows status after refresh, including offline pending counts.

## Rollout and limitations
- Only a scope's authoritative Home can initiate this signed deletion. A Replica
  must not forge or migrate Home ownership implicitly.
- Devices with outdated Agents cannot process deletion; they remain Pending
  until upgraded and reconnected. No false account-wide Completed claim.
- The server persists scope ID, owner-given scope name, signature, target device
  IDs and ACK timestamps, not checkpoint bodies, event text or raw transcripts.
- Existing snapshots, exported files and disconnected/decommissioned backups
  are outside the live-device erasure guarantee.
- Owner authorization currently requires Wall authentication, CSRF and two
  confirmations. Stronger server-verifiable owner-principal attestation is a
  future security hardening gate.
- Migration 037 is applied explicitly by lr_gold_migrator, never by the
  runtime lr_gold_app role. Production is not part of this rollout.
- Use isolated temporary SQLite/PG fixture records; never delete real user data
  as an automated acceptance test.

## Verification
New scoped signing and tombstone fixture, existing Home/Replica E2EE regression,
Gold Wall navigation and packaging checks must all pass. A second real Agent
must ACK a test-only scope before E2E completion is claimed.
