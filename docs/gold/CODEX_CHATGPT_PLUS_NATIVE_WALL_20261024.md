# Gold native Codex Bridge - Sign in with ChatGPT (Plus plan)

User requirement: use ChatGPT-plan Codex without Platform API keys. Gold must
have ONE Wall and keep all original Gold features and restore point.

## Official baseline
restore tag gold-restore-before-memory-codex-20261024 -> ba579f8
Owner-accepted Windows #486 source -> 3076694.
Single existing LXD: light-remote-gold-uat.
Same Git branch: feature/gold-m6-integrated-20261023.

## Implementation
- Codex 0.164.0 in a local npm install at /opt/light-remote-gold-codex-runtime
  inside the existing UAT. Not installed globally and not in Gold core runtime.
- Codex app-server child over local stdio JSON-RPC with bounded timeouts and
  denied unsolicited approval requests. No additional listener or Wall.
- Login via official account/login/start type chatgptDeviceCode, returning
  an OpenAI HTTPS verification URL and user code displayed inside existing
  Gold Wall. Owner completes browser authorization independently.
- Credentials stored in private mode-0700 CODEX_HOME under Gold UAT wall data,
  not in the browser, Git, or OpenAI Platform API key storage.
- Child environment explicitly excludes OPENAI_API_KEY, CODEX_API_KEY,
  CODEX_ACCESS_TOKEN and ACCESS_TOKEN to avoid unintended paid API fallback.
- Owner-authenticated Gold Wall routes with CSRF required for mutations.
- Existing paid API key UI is removed from the visible Codex section and
  old paid API execution routes return HTTP 410. Previously saved encrypted
  key is preserved but never used by the new ChatGPT-plan feature.
- Optional read-only Codex observer uses ephemeral threads, sandbox read-only,
  approvalPolicy never, isolated working directory, and rejects unsolicited
  RPCs. Does not use Light Remote privileged tools.
- Two feature flags remain independent; both OFF preserves ordinary Gold.
  Opening Wall does not automatically start login or a Codex inference turn.

## Evidence and acceptance
Source mocks validate device auth JSON-RPC and one Gold Wall plus existing
filesystem permissions and owner/CSRF protections. Immutable Gold #486
byte parity checks 90 frozen core files, with approved additive Wall and
Agent entrypoint changes only. Actual owner OAuth sign-in and Plus inference
are separate acceptance gates. Never claim login is complete before the
owner approves the code. ChatGPT Plan quotas are NOT Platform API billing.

## Owner workflow
1. Open Gold Wall, turn Codex Bridge ON, choose Sign in with ChatGPT.
2. Open the official verification URL shown by Codex and enter the one-time
   code in a browser logged into ChatGPT Plus.
3. Use Check sign-in on the same Gold Wall; status should show ChatGPT.
4. Optionally test read-only observer on an owner-visible local task.
5. Use Sign out to remove the isolated device Codex login.

No second LXD, Project Manager, Wall URL, service or Git branch. No new
snapshot. Preserve Account, PostgreSQL, Redis, A/B, Files, SCP, PTY, Fleet,
Real Remote, original Windows build, and immutable rollback tag.

## UAT activation receipt
Commit a18bcf27cce9faba947a2c6da1ee4b1ccaccbe96 was staged directly
from Git archive into the existing light-remote-gold-uat LXD:
 /opt/light-remote-gold-uat-candidates/a18bcf27cce9faba947a2c6da1ee4b1ccaccbe96/
The existing four Gold systemd units were switched from the old build
bb615ef to a18bcf2 with the required Gold Wall daemon argument.
No SQL changes, owner password reset, snapshot, new branch or second Wall.

Evidence:
- Immutable 90-file Gold #486 byte-parity PASS for the 93-file staged package.
- Eleven source regression tests PASS including owner FS roots, SCP, Permissions,
  nonblocking Wall, Gold M6 and Codex Plus JSON-RPC mock.
- Candidate critical binaries matched Git SHA. Operator/Plugin/Supervisor,
  Native FS, SCP and Wall status-cache byte-identical to previous UAT.
- Real Codex 0.164.0 app-server initialize and account/read PASS as Gold UAT
  service user, isolated CODEX_HOME, no ChatGPT sign-in yet.
- Four Gold runtime units active, Gold Wall /login HTTP 200, Plugin health 200,
  unauthenticated Codex Plus status HTTP 401, NetBird Wall /login HTTP 200.
- Owner OAuth device code NOT completed and ChatGPT-plan inference NOT yet
  acceptance-tested. Browser button and code approval must be done by owner.
- Old saved Platform credential is preserved but unused. No API key needed for
  ChatGPT Plan mode; old paid endpoints are disabled.
- Restore gold-restore-before-memory-codex-20261024 remains ba579f8.
- No new LXD snapshot requested or created.

For regression rollback: return the four original Gold unit ExecStart paths
to /opt/light-remote-gold-uat-git486-20261024 and preserve the Wall
daemon argument. Re-start Operator, Supervisor, Plugin, Wall; keep all
PostgreSQL, Redis, enrollment and owner-selected filesystem roots intact.

## Owner acceptance: REAL Plus login and Codex read-only inference — 2026-10-24
After the owner completed the official device-code sign-in on the SINGLE Gold
Wall, their browser screenshot independently displayed:
- "ChatGPT Codex signed in · plus · No OpenAI Platform API key required."
- The original owner task title "Kiểm tra kết nối Codex Bridge".
- "Result: completed" and a concise Vietnamese Codex observer response.

A separate READ-ONLY live verification within light-remote-gold-uat as
gold-uat using its same private CODEX_HOME returned:
- codexLoginConnected=true, codexLoginMode=chatgpt, codexPlan=plus.
- Both Long Memory and Codex Bridge are enabled.
- Gold Wall/Operator/Plugin/Process Supervisor/PostgreSQL/Redis: all active.
- Official immutable restore tag remains ba579f8830a0654e8321204f17270db8d94c5593.
- No additional inference invocation occurred in this verification.

The task still showed todo and local Task Controller recommendation CONTINUE.
This is EXPECTED: observer inference is READ-ONLY, and a completed model
turn MUST NOT silently mark a user task complete. Only owner-controlled
task state transitions are authoritative. Original Gold Wall frontend said
"Codex runtime: not connected" because it used an old hardcoded local
Task Controller label, despite the separate Plus auth successfully connected.
UI label is corrected to distinguish Task Controller from live Codex sign-in.
This checkpoint proves real Plus login and one completed observer turn,
not automatic ChatGPT Web session continuation or Long Memory cross-session
retrieval. Those remain separate OPEN acceptance gates.
