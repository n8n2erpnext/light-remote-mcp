# Gold Long Memory: signed checkpoint submission — handoff 2026-10-24

Source feature checkpoint before this change: 0f5b0079cfbdca72870ea54d46535d900e58ec0f
Branch: feature/project-continuity-plan-20261023
Frozen owner-tested Gold Windows #486: 30766940ac18e55cb735354b40a3af9ba37eddb8
Gold M6: ba579f8830a0654e8321204f17270db8d94c5593
RELEASE: BLOCKED; no installer, production deploy or Gold UAT modifications.

## Scope from owner

Extend the SAME tested Gold Account, Wall, Agent, Operator, official Plugin, A/B permissions, Fleet, FS/PTY. Long Memory and Codex Observer are device-global optional modules, both default OFF and independently ON/OFF. No Project creation required. SQLite and secrets live only on local user client. Gold cloud only relays bounded requests in memory, does not store Memory on PostgreSQL/Redis. Codex OBSERVES and RECOMMENDS, never executes jobs, sends ChatGPT Web messages, or automatically continues turns via unsupported API.

## What changed

Gold plugin additive opt-in tool: light_remote_long_memory_checkpoint(sessionId,operationId?,projectId?,body,kind?,sourceRef). Default projectId is hidden local scope 00000000-0000-4000-8000-000000000001; there is NO visible required Project. A ChatGPT agent may submit source-labelled short milestones while it still has context, instead of asking owner to type a handoff. Notes are always UNVERIFIED until owner evidence confirmation. This cannot capture invisible ChatGPT Web context that is never provided to the plugin.

Remote write is a separately owner-approved option in the same Gold Wall Continuity screen, with existing account/owner password step-up and Ed25519 signer, distinct from remote READ permission. The Gold Operator requires ACTIVE account-owned A/B session and remote:write permission, and signs a separate 6-second write delegation containing account/device/agent/session/project/requestId and a SHA256 commitment to note body/kind/sourceRef. A read proof cannot be used as a write proof.

Uses existing Gold confidential project-request frame in device duplex; bypasses persisted Gold jobs. The unchanged Gold Agent forwards an authenticated request to isolated local Owner Broker. Broker verifies pinned Operator signature, local signed owner write consent, and Memory ON; SQLite v11 stores note and a requestId in ONE transaction. Retrying exact operationId/same payload returns prior note receipt; a changed payload with same operationId is denied. Memory OFF or owner permission revoke denies writes. Gold route only returns {saved,id,duplicate}, not raw note content.

The existing Gold connection_helper, after owner-approved separate READ permission, continues offering bounded local context in a new Web session. The new source path does not require creating another account or Wall. Codex remains a read-only observer and was not changed.

## Evidence and source coverage

PASS in isolated local/source tests:
- GOLD_PLUGIN_SIGNED_CHECKPOINT_ROUTE_ACTIVE_AB_AND_NO_CLOUD_RECEIPT_BODY_PASS
- GOLD_PLUGIN_OFF_OFF_AND_UNAUTHORIZED_SESSION_DENIAL_PASS
- SIGNED_GOLD_OPERATOR_WRITE_CONSENT_SEPARATE_FROM_READ_PASS
- SIGNED_GOLD_OPERATOR_NOTE_HASH_TAMPER_AND_REPLAY_PASS
- SIGNED_GOLD_DEVICE_LOCAL_SQLITE_WRITE_ONLY_AND_REVOKE_PASS
- SAME_GOLD_WALL_SEPARATE_SIGNED_REMOTE_WRITE_STEPUP_REVOKE_PASS
- SQLite schema migration v3 -> v11 and owner sealed-key rewrap receipts
- Earlier signed confidential READ, OFF/OFF, global module and Codex read-only mock regression
- Gold Client Core staged and SHA256 verified; rc.49 source, 102 packaged files, original Gold Wall assets/Permissions/branding unchanged.

Main code touched: device-agent/project-continuity-{store,client,ipc,owner-broker,owner-grants,page}.mjs; device-agent/local-wall.mjs; device-agent/operator-agent.mjs; lib/project-continuity-session-proof.mjs and lib/device-duplex-client.mjs; operator-host/executor.mjs, executor-routes-plugin.mjs, device-duplex-session.mjs; plugin-server/tools.mjs and operator-adapter.mjs. Focused new tests for signed broker write and plugin route, existing Gold Wall global API test extended.

## Not yet proven, MUST remain OPEN

1. Real installed official Gold Plugin tool availability and a LIVE owner-approved ChatGPT Web session A -> B continuity workflow. Tests are source and local IPC fixtures.
2. One shared production Gold Account identity and Wall account-only owner credential/signer setup on a physical installed Client. Never create test-only second Account.
3. Gold Operator outer HTTP request/body telemetry across errors and proxy layers must be privacy-audited for no stored Memory bodies. New route itself creates no job or DB journal row.
4. Automatic capture covers only Light Remote observable results and milestones the ChatGPT agent submits. No hook is known for hidden Web conversation/context or remaining context token budget. Do not guarantee zero missed context.
5. Codex authentic observation using owner Plus quota, the supported continuation hook for ChatGPT Web, Windows Service SID/Named Pipe DACL, Linux Server physical parity, macOS and Linux Desktop.
6. No new installer, UAT account/enrollment workaround, fake Wall, standalone Project Manager or cloud Memory service may be added to shortcut these gates.

## Next exact work

Use existing owner-enrolled Gold Account + SAME Wall on a physical Windows/Linux Server UAT client; turn Long Memory ON and separately authorize read and write, then call official checkpoint from ChatGPT session A with stable operation IDs, reopen Web session B and recover relevant context from the ordinary Gold connection_helper. Verify retry idempotency, revoke and OFF/OFF unchanged Gold FS/PTY/Fleet/Permissions. Leave Codex observer implementation independent.
