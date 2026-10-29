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

## UAT receipts / authoritative end-of-turn state
Gold source commit f79dc9da22fccf8587655a99218d411ad4fe9866 initially activated
on light-remote-gold-uat. Follow-up exact-device binding fix is
17030d90d142aa82d9985af955d487d93ce1ac40 (CURRENT UAT running SHA).
These are on the same original Gold development branch.

One existing Wall: http://100.94.184.141:5591/
One existing LXD: light-remote-gold-uat.
Four Gold services plus PostgreSQL/Redis remain active; Account, A/B,
filesystem roots, SCP, PTY and existing Gold source preserved.
No new snapshot. No second Wall or new service. Gold pre-feature restore tag
gold-restore-before-memory-codex-20261024 stays ba579f8.

The existing Gold Plugin systemd service has two nonsecret environment values
pinning the exact installed Client root and enrolled Gold UAT device:
LIGHT_REMOTE_GOLD_MEMORY_CLIENT_ROOT =
  /opt/light-remote-gold-uat-candidates/17030d90d142aa82d9985af955d487d93ce1ac40
LIGHT_REMOTE_GOLD_MEMORY_DEVICE_ID = dev_e68276c691ba5413f42d5dde
Both values are target constraints, not bearer tokens. An authorized session
for a different device is denied when the default root is used.

Tests:
- 11 existing Gold Core regressions PASS.
- Immutable Gold #486 90-file parity PASS on 95-file staged Client.
- Gold Wall /, /permissions, /approve, /settings package smoke PASS.
- Owner and CSRF gate for handoff endpoints PASS.
- SQLite Session A -> independent Session B read and HMAC verification PASS.
- Direct CLI process A save -> process B read under gold-uat in same LXD PASS.
- Real owner-storage checkpoint ID: 353b1231-e27e-4ffc-9004-8200a0686cda;
  source: owner instructions and verified Gold UAT ChatGPT conversation
  on 2026-10-24; HMAC verification PASS after service restart.
- Codex ChatGPT Plus still connected after Wall/Plugin restart.
- Codex task remains todo, no inference calls made by acceptance checks.
- Real read-only Codex completed model turn previously owner-tested.
- Operator/Plugin/Wall/Supervisor all active on new Git source and NetBird
  /login HTTP 200.

Important remaining release gates (OPEN):
1. Existing ChatGPT Gold connector is NOT A/B-paired into this current chat.
   Its helper returned need_a_code. Owner must provide a NEW one-time
   A code from the SAME Gold UAT Wall (not the ARM production Wall),
   approve the B code, then reconnect/reload the official connector.
2. Current ChatGPT client tool catalog does not yet expose the new
   light_remote_long_memory_read or light_remote_long_memory_checkpoint
   tool names even though UAT plugin source registers them. Refreshing
   the connector tool catalog/publishing may be required.
3. Only after both gates can real ChatGPT Web Session A save through MCP,
   separate Web Session B retrieve through MCP, and owner approve outcome.
   Do not call source process simulation a live ChatGPT Web cross-session PASS.
4. Windows/macOS/Linux Desktop installation path binding and physical
   owner-client parity for new features remain unverified.
5. Model feedback is not task execution; owner must approve any receipt
   transition. No automatic ChatGPT Web turn continuation.
