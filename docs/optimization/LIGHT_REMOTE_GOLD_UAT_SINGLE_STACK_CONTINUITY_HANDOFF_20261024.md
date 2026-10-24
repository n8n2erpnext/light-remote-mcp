# Gold UAT — One full Gold stack with optional Long Memory + Codex Observer

Date: 2026-10-24 Asia/Ho_Chi_Minh
Source branch: feature/project-continuity-plan-20261023; source pre-deployment checkpoint 2bcda5ea21348850a08c68e88d023b98be39c16e
Frozen Gold Windows #486 source: 30766940ac18e55cb735354b40a3af9ba37eddb8d
Original Gold M6 source: ba579f8830a0654e8321204f17270db8d94c5593
RELEASE: BLOCKED. This is a REAL UAT stack, not completed ChatGPT Web/Codex acceptance or Windows installer.

## OWNER INSTRUCTION that overrides previous UAT design

There is ONE Gold Account and ONE existing Gold Wall; Project Continuity is no other product, no new Account, no extra Wall/server. Add Long Memory and Codex Observer modules directly into tested Gold. Everything private stays on the USER CLIENT. Both independent toggles OFF by default. No Project creation prerequisite. Codex only observes/co-ordinates, never acts as worker or secretly submits ChatGPT Web turns.

## LXD cleanup and rollback

- Original `light-remote-gold-uat`, static container IPv4 `10.192.135.61`, remains THE ONLY Gold feature acceptance target. Gold production and `light-remote-direct` were not touched.
- OFFLINE BTRFS snapshot captured BEFORE any Gold candidate code/service changes:
  `light-remote-gold-uat/pre-long-memory-codex-observer-20261024`
  It contains the complete original enrolled device, account-only Wall Auth, operator/plugin, PostgreSQL17, Redis and local Gold UAT systemd state. Container was stopped for coherent snapshot; restarted and all six services reverified. Btrfs copy-on-write storage `default` (40GiB pool).
- Owner explicitly requested removing the wrong separate Continuity UAT. `light-remote-continuity-uat` was DELETED via LXD and confirmed absent. Any synthetic `uat-owner` account it carried is NOT part of real Gold.
- Guarded rollback script: `deploy/scripts/uat-restore-gold-continuity-snapshot.sh --explicit-discard-post-snapshot-uat-changes` STOPS Gold UAT, restores snapshot and restarts. This intentionally loses ALL UAT changes AFTER snapshot; NEVER run automatically on production or without explicit rollback intent. The snapshot remains intact.

## Actual Gold runtime integration

Existing Gold UAT live runtime had several newer Permissions/Fleet/process fixes not identical to source feature branch. Cloned THE ACTUAL three running Gold packages with Btrfs reflink and performed 3-way merges against frozen Gold #486 ancestor, preserving existing Gold code and adding only necessary Continuity functionality. No raw overwrite of production code, Account DB, user auth, A/B enrollment, permissions or Fleet.

Installed integrated root: `/opt/light-remote-gold-uat-continuity-candidate/`:
- `agent` — existing Gold Client native Node runtime, assets, 102 package source entries, merged original Gold operator-agent/local-wall/device-duplex-client + original Gold Permissions callbacks and new local Memory modules.
- `plugin` — cloned installed Gold Plugin/node_modules with merged tools/operator-adapter and new optional auto-recall module.
- `operator` — cloned installed Gold Operator with merged signed read/write route and confidential duplex, local signed session proof.
- Internal bundled Continuity IPC is **lazily launched inside THE SAME Gold device Agent process**; no independently hosted Wall, new application or independent service. SQLite lives under `/var/lib/light-remote-gold-uat/wall/light-remote/continuity` in this UAT **client**. No Memory body in Gold PostgreSQL/Redis by design. Actual cloud logs / observability still need confidentiality acceptance.
- Existing `light-remote-gold-wall.service`, `light-remote-gold-plugin.service` and `light-remote-gold-operator.service` run this integrated candidate via a removable systemd drop-in named `zzzzzz-20261024-long-memory-codex-observer.conf` in each service's `.service.d`. NO new Gold app service unit.
- `LIGHT_REMOTE_PROJECT_CONTINUITY_EXPERIMENTAL=1` activates optional UI/tool exposure. Two device module toggles themselves remain OFF until owner opts in, and CodeX stays observer-only.
- `OPERATOR_AGENT_WALL_AUTH_FILE=/var/lib/light-remote-gold-uat/wall/auth.json` remains `mode=account-only`, preserving **existing Gold Account login**. No UAT test credentials cloned. Current device remains actually enrolled under its original Gold account and deviceId (no new enrollment).
- Local relay trust Ed25519 Operator private key (600) and owner/account/device-bound local public pin created only within Gold UAT under `/var/lib/light-remote-gold-uat/wall/`. No token displayed/copied into Git; NEVER share private key. It is NOT a new Gold Account. Owner must still authenticate using normal Gold account and independently approve remote Memory read and write through same Wall.
- Gold Portal is now locally reachable from SAME LXD at `http://10.192.135.61:5583`, and Gold Wall BASE/HUB point there (previous `https://gold.light-remote.thaiduy.digital/healthz` returned HTTP 404 from Gold UAT). The internal UAT plugin Host allowlist adds only `10.192.135.61` to existing Gold domain. This avoids Cloudflare and does not publish a new port or create a new Wall. It was verified by HTTP health from LXD.

## What the user opens

**Same EXISTING Gold Wall over NetBird:** `http://100.94.184.141:5491/projects` (sidebar navigation label **Continuity**). This URL is WITHIN the real Gold Wall on port 5491; it redirects anonymous visitors to its existing login, whose `auth.json` is account-only. /account and Wall authenticate through the same Gold Account. No localhost SSH tunnel, fake username, Project Manager app, or port 5588 account portal. Standard Gold Permissions/Fleet/Agent remain on the same Wall at `http://100.94.184.141:5491/`.

After existing account login: Long Memory and Codex Observer global ON/OFF independently; default Memory/local Controller works without creating Project; granting separate remote READ/WRITE requires Gold owner password step-up (owner signer initialized lazily from verified Gold account credentials); Memory body local to client. The new official Plugin `light_remote_long_memory_checkpoint` tool exists in Gold UAT runtime, but official ChatGPT connector registration and session A→B acceptance must still be tested.

## Evidence

- Six Gold UAT services active on integrated source: Plugin, Operator, Wall, Process Supervisor, PostgreSQL17 and Redis.
- Existing enrolled Gold Agent candidate `operator-agent.mjs status`: `enrolled=true`, Linux, account/device present, cloud desired connection retained.
- Login GET `http://100.94.184.141:5491/login` = 200; unauthenticated `/projects` = HTTP 303 redirect to original Gold login; protected API unauthenticated = 401. No other Account/Wall.
- Original Gold Plugin direct `/healthz` = 200; module flag and callback exports verified.
- Merged installed Client manifest validates SHA256 of ALL 102 files, digest `f6f5fbd3e8262d63822d5a74a218340d880209e6fe2499a437c64cff9c16bf94` before latest IPC patch. Recompute/verify after updated module files before final release.
- `ONE_GOLD_LOCAL_CLIENT_SIGNED_MEMORY_READ_WRITE_NO_PROJECT_PASS`, `ONE_GOLD_LOCAL_CLIENT_OWNER_CONSENT_UNVERIFIED_CHECKPOINT_IDEMPOTENCY_PASS`, `SIGNED_GOLD_OPERATOR_WRITE_CONSENT_SEPARATE_FROM_READ_PASS`, signed Gold Wall/CSRF tests, four module settings and mock-only Codex observer source tests PASS.
- No duplicate UAT application; bad `light-remote-continuity-uat` removed.

## MUST remain OPEN — do not pretend full acceptance

1. No authenticated owner interaction through real Gold UAT Wall has yet been performed in ChatGPT; owner opens above real Gold Wall with their existing Account, enables Long Memory, separately approves remote read and write. No owner login password requested or known here.
2. Official Gold UAT plugin tool must be discovered from a REAL ChatGPT Web Session A using authenticated A/B; send one source-labelled note, create new chat Session B and verify native `connection_helper` recovers context with no manual handoff. Must not claim automatic discovery/auto-call without evidence.
3. `device_channel_failed: http_502` and `supervisor_owner_invalid` appeared in Gold Wall logs (the supervisor issue was present before this modification). Despite internal Gold health being green, device duplex/session and PTY receipts need a real acceptance trace. The Gold UAT Account/Wall are active but not all native capabilities proven.
4. Codex Bridge is STILL observer-only plan ledger/mock app-server source. No owner-authenticated real Codex Plus runtime/ChatGPT Web auto-continuation API proven. The feature must NOT execute work.
5. Windows Service SID/Named Pipe DACL, macOS launchd/Keychain and Linux Desktop parity, true no-cloud-log leakage proof, installer roll-out remain OPEN. Source test PASS is not production PASS.

## Next implementation/acceptance focus

Do not build more UAT LXD/Accounts. On THIS Gold Wall and existing `/account`: owner signs in, switches Long Memory ON, opts into signed read and write, checks persisted SQLite; use a Gold A/B session and official plugin to submit/retrieve source-labelled checkpoint between two ChatGPT Web chats. Independently test Codex observer using owner-authorized Plus without taking over command execution. If an integration bug arises, fix this feature branch, deploy only to same Gold UAT then reuse existing snapshot for rollback if necessary.
