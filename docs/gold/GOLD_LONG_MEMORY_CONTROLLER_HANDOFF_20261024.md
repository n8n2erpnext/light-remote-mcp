# Gold Long Memory + Codex Task Controller — integrated UAT plan / receipts

Owner accepted official immutable restore:
gold-restore-before-memory-codex-20261024 => ba579f8830a0654e8321204f17270db8d94c5593.
Never merge discarded project-continuity implementation, never create second
Account/Wall/Project/LXD, never overwrite Gold PG/Redis/enrollment/permissions.

## Required state UI correction
Gold Wall module header now renders actual flags from /api/gold/modules:
Long Memory ON/OFF and Codex Bridge ON/OFF. No permanent "OFF by default"
text. The four independent combinations are read dynamically after each
save and after browser load.

## Long Memory
- Client-local SQLite in the existing Agent storage (Gold Wall data).
- Optional device-global, no mandatory project, disabled = no reads/writes.
- Owner-approved checkpoint with source, title, body (max 12KiB) and type.
- Append-only checkpoint with local device HMAC signature backed by
  separate mode-0600 random key; reads detect database tampering.
- "Signed" here means device-local HMAC integrity, NOT TPM, public-key
  attestation or cryptographic proof of the speaker's identity.
- Gold Wall same-page Save checkpoint, List, and Preview handoff.
- Gold Plugin on same Gold OAuth/A-B governed session exposes:
  light_remote_long_memory_read and light_remote_long_memory_checkpoint.
  SessionId must specify the actual A/B-authorized Gold device. Both tool
  operations require remote:execute and device-local capabilities.
  The bridge uses an allowlisted CLI action, not arbitrary user scripts.
  It does not bypass owner permissions or revive unapproved device access.
- New ChatGPT Web session can retrieve these *explicitly saved* checkpoints
  after reconnecting to the same Gold device with official Plugin A/B.
  No access to hidden Web conversation state. Do not silently invent context.
- Remote exec script encodes a bounded user-approved checkpoint body as
  base64url. It is shell-inert but could be visible in Operator audit logs;
  do not put raw secrets in checkpoints. Native typed Memory transport is
  future hardening; source-level Plugin route is not yet claimed to be
  published to every existing installed Gold connector catalog.

## Task Controller and Codex
- Codex observer uses ChatGPT Plus account via official local app-server.
- A completed Codex turn with nonempty model output stores a receipt
  containing task IDs and exact states/changedAt at observation time.
- Codex NEVER silently marks todo -> done; current owner task state
  remains authoritative.
- Gold Wall lists receipts. Owner can explicitly approve a selected
  receipt and task as done. SQLite update compares original state and
  changedAt; stale/conflicting receipts FAIL CLOSED.
- Tasks, notes and checkpoints independent; Codex OFF cannot access
  Controller state, Long Memory OFF cannot read checkpoints.
- No auto-resume of ChatGPT Web, no injection, no delegated worker.
- Future session "continue" = assistant reads trusted checkpoint, asks
  owner what to do next if necessary, and uses ordinary authorized tools.

## Acceptance needed
1. Source regression + staged package immutable Gold #486 parity.
2. Deploy same Git SHA to existing light-remote-gold-uat only, backup point
   is existing immutable restore source (NO snapshot).
3. Browser verify header states and checkpoint + receipt controls.
4. Test Gold Plugin tool visibility; from ChatGPT Session A save an
   approved handoff, from NEW Session B read it and confirm ID+HMAC.
5. Owner approve task after real Codex receipt, verify no automatic task
   mutation and no stale receipt acceptance.
6. Windows/Mac/Linux desktop cross-platform install packaging/UAT remains
   separate; Linux UAT success is not automatic platform parity.
